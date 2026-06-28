export function Header() {
  return (
    <header className="site-header">
      <a href="/" className="header-logo">
        <div className="logo-slot">
          <span className="logo-ph">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </span>
        </div>
        <span className="logo-word">סודוקו</span>
      </a>

      <div className="header-divider" aria-hidden="true" />
      <nav className="header-nav">
        <a href="/daily">יומי</a>
        <a href="/print" className="nav-hide-sm">
          להדפסה
        </a>
        <a href="/how-to-play" className="nav-hide-sm">
          איך לשחק
        </a>
      </nav>
    </header>
  );
}
