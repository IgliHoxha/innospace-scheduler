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
        <div className="site-footer-text">
          <span className="site-footer-copy">
            © {new Date().getFullYear()} Innospace Tirana. All rights reserved.
          </span>
          <span className="site-footer-copy">
            Created by{" "}
            <a
              className="site-footer-credit"
              href="https://stackrover.tech"
              target="_blank"
              rel="noopener"
            >
              stackrover.tech
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
