// Stack Rover's own cube mark, as in its favicon.
function StackRoverMark() {
  return (
    <svg
      className="site-footer-credit-mark"
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" fill="#0B1013" />
      <path d="M8 11 L16 7 L24 11 L16 15 Z" fill="#4CC9F0" />
      <path d="M8 11 L8 21 L16 25 L16 15 Z" fill="#1A262C" />
      <path d="M24 11 L24 21 L16 25 L16 15 Z" fill="#FF7A45" />
      <circle cx="16" cy="11" r="1.6" fill="#0B1013" />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="site-footer-logo"
          src="/logo.svg"
          alt="Innospace Tirana"
        />
        <a
          className="site-footer-credit"
          href="https://stackrover.tech"
          target="_blank"
          rel="noopener"
        >
          <StackRoverMark />
          <span>
            Created by{" "}
            <span className="site-footer-credit-name">stackrover.tech</span>
          </span>
        </a>
      </div>
    </footer>
  );
}
