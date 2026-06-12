import { createOpenAICompatible, type OpenAICompatibleProviderSettings } from "@ai-sdk/openai-compatible";
import { generateText, Output, stepCountIs, type ToolSet } from "ai";
import { z } from "zod";
import { AGENT_NODE_SPECS } from "./agent-node-specs.js";
import {
  runAgentNode,
  type AgentNodeExecutionRequest,
  type AgentNodeToolSet,
} from "./agent-node-runtime.js";
import type { Confidence, ResourceSnapshot } from "./domain.js";
import type {
  PackageRecognitionDecision,
  PackageRecognitionInput,
} from "./package-normalizer.js";
import type {
  AcquisitionPlanningInput,
  AcquisitionPlanningResult,
  AgentNodes,
} from "./ports.js";

const DEFAULT_PROVIDER_NAME = "xiaomi-mimo";
const DEFAULT_BASE_URL = "https://token-plan-sgp.xiaomimimo.com/v1";
const DEFAULT_MODEL_ID = "mimo-v2.5-pro";

const acquisitionPlanningSchema = z.object({
  selectedSnapshotId: z.string().nullable(),
  searchedKeywords: z.array(z.string()),
  candidateDispositions: z.array(
    z.object({
      candidateId: z.string(),
      disposition: z.enum(["selected", "rejected", "uncertain"]),
      episodes: z.array(z.string()),
      reason: z.string(),
    }),
  ),
  confidence: z.enum(["low", "medium", "high"]),
  reason: z.string(),
});

const packageRecognitionSchema = z.object({
  fileMappings: z.array(
    z.object({
      providerFileId: z.string(),
      seasonNumber: z.number().int().positive(),
      episodeNumber: z.number().int().positive(),
      confidence: z.enum(["low", "medium", "high"]),
      reason: z.string(),
    }),
  ),
  rejectedProviderFileIds: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]),
  reason: z.string(),
});

type AcquisitionPlanningOutput = z.infer<typeof acquisitionPlanningSchema>;
type PackageRecognitionOutput = z.infer<typeof packageRecognitionSchema>;
type StructuredOutput = AcquisitionPlanningOutput | PackageRecognitionOutput;

export interface StructuredOutputRequest extends AgentNodeExecutionRequest {}

export type GenerateStructuredOutput = (request: StructuredOutputRequest) => Promise<StructuredOutput>;

export interface VercelAiAgentNodesOptions {
  apiKey?: string;
  baseURL?: string;
  modelId?: string;
  providerName?: string;
  generateStructuredOutput?: GenerateStructuredOutput;
}

export class VercelAiAgentNodes implements AgentNodes {
  private readonly generateStructuredOutput: GenerateStructuredOutput;

  constructor(options: VercelAiAgentNodesOptions = {}) {
    this.generateStructuredOutput =
      options.generateStructuredOutput ?? createAiSdkStructuredGenerator(options);
  }

  async planAcquisition(input: AcquisitionPlanningInput): Promise<AcquisitionPlanningResult> {
    const snapshots: ResourceSnapshot[] = [];
    const result = await runAgentNode({
      spec: AGENT_NODE_SPECS.AcquisitionPlanningAgent,
      input: {
        title: input.title,
        aliases: input.aliases,
        seasonNumber: input.seasonNumber,
        qualityPreference: input.qualityPreference,
        missingEpisodes: input.missingEpisodes,
        latestAiredEpisode: input.latestAiredEpisode,
        initialKeyword: input.initialKeyword,
        failureEvidence: input.failureEvidence,
      },
      tools: {
        searchResources: {
          readOnly: true,
          description:
            "Search the resource provider with one keyword. Read-only. Returns the full persisted ResourceSnapshot; judge from this complete evidence. Returns {keyword, error} when the provider fails.",
          inputSchema: AGENT_NODE_SPECS.AcquisitionPlanningAgent.toolInputSchemas.searchResources,
          execute: async ({ keyword }) => {
            try {
              const snapshot = await input.searchResources({ keyword });
              snapshots.push(snapshot);
              return {
                snapshotId: snapshot.id,
                provider: snapshot.provider,
                keyword: snapshot.keyword,
                candidateCount: snapshot.candidates.length,
                candidates: snapshot.candidates.map((candidate) => ({
                  id: candidate.id,
                  title: candidate.title,
                  type: candidate.type,
                  source: candidate.source,
                  episodeHints: candidate.episodeHints,
                  qualityHints: candidate.qualityHints,
                })),
              };
            } catch (error) {
              return { keyword, error: error instanceof Error ? error.message : String(error) };
            }
          },
        },
      },
      executor: this.generateStructuredOutput,
    });
    const output = acquisitionPlanningSchema.parse(result.output);

    return {
      plan: {
        node: "vercel_ai_acquisition_planning",
        selectedSnapshotId: output.selectedSnapshotId,
        searchedKeywords: output.searchedKeywords,
        candidateDispositions: output.candidateDispositions,
        confidence: output.confidence as Confidence,
        reason: output.reason,
      },
      snapshots,
      trace: result.trace,
    };
  }

  async recognizePackage(input: PackageRecognitionInput): Promise<PackageRecognitionDecision> {
    const result = await runAgentNode({
      spec: AGENT_NODE_SPECS.PackageRecognitionAgent,
      input: {
        title: input.title,
        year: input.year,
        files: input.files.map((file) => ({
          path: file.path,
          providerFileId: file.providerFileId,
          sizeBytes: file.sizeBytes,
        })),
        parserEvidence: input.parserEvidence,
      },
      executor: this.generateStructuredOutput,
    });
    const output = packageRecognitionSchema.parse(result.output);

    return {
      node: "vercel_ai_package_recognition",
      fileMappings: output.fileMappings.map((mapping) => ({
        ...mapping,
        confidence: mapping.confidence as Confidence,
      })),
      rejectedProviderFileIds: output.rejectedProviderFileIds,
      confidence: output.confidence as Confidence,
      reason: output.reason,
    };
  }
}

export function createXiaomiMimoAgentNodesFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): VercelAiAgentNodes {
  const options: VercelAiAgentNodesOptions = {};
  if (env.XIAOMI_MIMO_API_KEY !== undefined) {
    options.apiKey = env.XIAOMI_MIMO_API_KEY;
  }
  if (env.XIAOMI_MIMO_BASE_URL !== undefined) {
    options.baseURL = env.XIAOMI_MIMO_BASE_URL;
  }
  if (env.XIAOMI_MIMO_MODEL_ID !== undefined) {
    options.modelId = env.XIAOMI_MIMO_MODEL_ID;
  }
  return new VercelAiAgentNodes(options);
}

export function createXiaomiMimoProviderConfig(options: VercelAiAgentNodesOptions = {}): {
  providerSettings: OpenAICompatibleProviderSettings;
  modelId: string;
} {
  const providerSettings: OpenAICompatibleProviderSettings = {
    name: options.providerName ?? DEFAULT_PROVIDER_NAME,
    baseURL: options.baseURL ?? DEFAULT_BASE_URL,
    ...(options.apiKey === undefined ? {} : { headers: { "api-key": options.apiKey } }),
  };

  return {
    providerSettings,
    modelId: options.modelId ?? DEFAULT_MODEL_ID,
  };
}

function createAiSdkStructuredGenerator(options: VercelAiAgentNodesOptions): GenerateStructuredOutput {
  const { providerSettings, modelId } = createXiaomiMimoProviderConfig(options);
  const provider = createOpenAICompatible(providerSettings);
  const model = provider(modelId);

  return async (request) => {
    const schema = schemaFor(request.schemaName);
    const tools = request.tools === undefined ? undefined : toAiSdkTools(request.tools);
    const { output } = await generateText({
      model,
      system: request.system,
      prompt: request.prompt,
      output: Output.object({
        schema: schema as any,
        name: request.schemaName,
      }),
      stopWhen: stepCountIs(request.maxSteps),
      ...(tools === undefined ? {} : { tools }),
    });
    return output as StructuredOutput;
  };
}

function schemaFor(schemaName: StructuredOutputRequest["schemaName"]) {
  switch (schemaName) {
    case "acquisition_planning":
      return acquisitionPlanningSchema;
    case "package_recognition":
      return packageRecognitionSchema;
    default:
      throw new Error(`No structured output schema registered for ${schemaName}`);
  }
}

function toAiSdkTools(tools: AgentNodeToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => [
      name,
      {
        description: definition.description,
        inputSchema: definition.inputSchema,
        execute: definition.execute,
      },
    ]),
  ) as ToolSet;
}
