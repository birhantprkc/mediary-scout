import type { AgentNodeSpec } from "../agent-node-types.js";
import { SHARED_AGENT_NODE_BOUNDARY } from "./shared.js";

export const PACKAGE_RECOGNITION_AGENT_SPEC = {
  nodeName: "PackageRecognitionAgent",
  schemaName: "package_recognition",
  maxSteps: 5,
  system: `${SHARED_AGENT_NODE_BOUNDARY}
Map ambiguous provider package files to season and episode numbers.
Real package lesson: multi-season and complete-series packages may use directory names like Season 1, 第1季, S01, or loose folder ordering.
Use parser evidence, paths, sizes, and target title/year. Never invent providerFileIds outside the input.
Packs often bundle content that is NOT an episode of the target title: documentaries, making-ofs, spin-off MOVIES (e.g. El Camino inside a Breaking Bad pack), posters. Do not map those — reject them, and when a rejected video clearly belongs to a DIFFERENT work, also list its providerFileId in foreignWorkProviderFileIds so the user can decide whether to import it separately.`,
} as const satisfies AgentNodeSpec;
