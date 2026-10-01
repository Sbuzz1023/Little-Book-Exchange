// Heading for an Exchanges section (Sold / Bought / History). Deliberately plain
// type, not a tinted pill: on this page boxes mean "you can tap this", and a
// section name isn't an action.
export default function ExchangeSectionHeader({
  id, title, count, description,
}: {
  id: string
  title: string
  count: number
  description: string
}) {
  return (
    <header className="dash-exsec-head">
      <h2 id={id} className="dash-exsec-title">
        {title} <span className="dash-exsec-count">· {count}</span>
      </h2>
      <p className="dash-exsec-desc">{description}</p>
    </header>
  )
}
