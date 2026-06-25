type Props = {
  color: string
  bgColor?: string
  direction?: 'down' | 'up'
}

export default function ScallopDivider({ color, bgColor = 'transparent', direction = 'down' }: Props) {
  const encodedColor = encodeURIComponent(color)
  const path = direction === 'down'
    ? `M0,22 Q15,0 30,22 Q45,0 60,22 Q75,0 90,22 Q105,0 120,22 L120,22 L0,22Z`
    : `M0,0 Q15,22 30,0 Q45,22 60,0 Q75,22 90,0 Q105,22 120,0 L120,22 L0,22Z`

  const svgUrl = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 22'%3E%3Cpath d='${path}' fill='${encodedColor}'/%3E%3C/svg%3E")`

  return (
    <div
      style={{
        height: 22,
        backgroundImage: svgUrl,
        backgroundRepeat: 'repeat-x',
        backgroundSize: '120px 22px',
        backgroundColor: bgColor,
      }}
    />
  )
}
