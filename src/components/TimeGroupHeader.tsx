type Props = { label: string };

export function TimeGroupHeader({ label }: Props) {
  return (
    <div className="time-group-header" role="separator">
      <span className="time-group-header__line" />
      <span className="time-group-header__label">{label}</span>
      <span className="time-group-header__line" />
    </div>
  );
}
