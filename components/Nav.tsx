import Link from 'next/link'

export default function Nav() {
  return (
    <nav className="relative bg-white z-10 flex items-center justify-between px-8 h-16 border-b-4 border-bk-orange">
      <Link href="/" className="font-display text-2xl text-bk-orange flex items-center gap-2">
        <span className="bg-bk-orange rounded-full w-9 h-9 flex items-center justify-center text-lg">🏡</span>
        LittleBookExchange
      </Link>
      <div className="flex items-center gap-6">
        <Link href="/listings" className="font-bold text-gray-700 hover:text-bk-orange transition-colors">Browse</Link>
        <Link href="/post" className="font-bold text-gray-700 hover:text-bk-orange transition-colors">Post a Book</Link>
        <Link href="/auth/signin" className="font-bold text-gray-700 hover:text-bk-orange transition-colors">Sign In</Link>
        <Link href="/auth/signup" className="bg-bk-orange text-white px-5 py-2 rounded-full font-extrabold hover:bg-bk-orange-dark transition-colors">Join Free</Link>
      </div>
    </nav>
  )
}
