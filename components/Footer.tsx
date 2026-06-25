export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-400 text-center py-7 text-sm font-bold">
      <span className="font-display text-bk-orange text-base">LittleBookExchange</span>
      {' · '}Books finding new homes in your neighborhood{' · '}© {new Date().getFullYear()}
    </footer>
  )
}
