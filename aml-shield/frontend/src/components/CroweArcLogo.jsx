// Crowe ARC sidebar/login logo. The same image is wired up as the
// browser-tab favicon from index.html, so there is exactly one image asset
// across the product.

export default function CroweArcLogo({ size = 36, className = '' }) {
  return (
    <img
      src="/crowe-arc-logo.png"
      width={size}
      height={size}
      alt="Crowe ARC"
      draggable={false}
      className={className}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  );
}
