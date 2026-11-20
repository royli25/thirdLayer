export function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
      <h2 className="text-lg font-medium tracking-tight text-ink">{title}</h2>
      {right}
    </div>
  );
}
