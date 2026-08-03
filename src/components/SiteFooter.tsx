// A white footer bar on every authenticated screen, mirroring innospacetirana.com's.
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
        <span className="site-footer-copy">
          © {new Date().getFullYear()} Innospace Tirana. All rights reserved.
        </span>
      </div>
    </footer>
  );
}
