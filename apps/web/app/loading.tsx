import { Film, Search } from "lucide-react";

export default function Loading() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Film size={18} aria-hidden />
          </span>
          <span className="brand-copy">
            <strong>Media Track</strong>
            <span>115 library ops</span>
          </span>
        </div>
      </aside>
      <main className="main product-main">
        <div className="product-tabs">
          <span className="is-active">搜索获取</span>
          <span>我的媒体库</span>
        </div>
        <section className="search-surface">
          <div className="search-hero">
            <div>
              <h1>搜索</h1>
              <p>正在载入。</p>
            </div>
            <div className="search-form">
              <div className="skeleton skeleton-input">
                <Search size={18} aria-hidden />
              </div>
              <div className="skeleton skeleton-button" />
            </div>
          </div>
          <div className="candidate-grid">
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </div>
        </section>
      </main>
    </div>
  );
}
