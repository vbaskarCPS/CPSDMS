// src/planner/screens/ComingSoon.tsx — a tab that's planned but not built yet.
export function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <main className="pl-page pl-stack pl-fade">
      <p className="pl-eyebrow">Coming soon</p>
      <h1>{title}</h1>
      <p className="pl-muted">{blurb}</p>
    </main>
  );
}
