// src/planner/ui/RvMark.tsx — the planner's mark as the bottom bar shows it: RV with a sparkle. It is the drawing of
// the small notification icon (public/planner-badge.png), with the letters reading RV here. It takes the colour of
// the text around it, so it works on every theme; its size is set where it's used (planner.css).
export function RvMark() {
  return (
    <svg className="pl-rvmark" viewBox="5 0 90 84" fill="currentColor" aria-hidden>
      <g transform="translate(2 22) scale(.8)">
        <path fillRule="evenodd" transform="translate(-44 0)" d="M53 74 V24 H72 C83 24 89 30 89 39.5 C89 46.5 85.6 51.2 79.8 53.4 L91 74 H76.5 L67.5 55.5 H66 V74 Z M66 35 V45.5 H70.5 C74.2 45.5 76 43.6 76 40.2 C76 36.8 74.2 35 70.5 35 Z" />
        <path transform="translate(38 0)" d="M9 24 H24 L34 56 L44 24 H58 L41 74 H26 Z" />
      </g>
      <path transform="translate(1 -2)" d="M72 4 C73.8 16.5 78.5 21.2 91 23 C78.5 24.8 73.8 29.5 72 42 C70.2 29.5 65.5 24.8 53 23 C65.5 21.2 70.2 16.5 72 4 Z" />
      <path transform="translate(-4 -1)" d="M44 8 C44.8 13.4 46.6 15.2 52 16 C46.6 16.8 44.8 18.6 44 24 C43.2 18.6 41.4 16.8 36 16 C41.4 15.2 43.2 13.4 44 8 Z" />
    </svg>
  );
}
