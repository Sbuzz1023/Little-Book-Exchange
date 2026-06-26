export default function MessagesPage() {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center text-center px-4"
      style={{ background: '#fffbf0', color: '#ccc' }}
    >
      <div style={{ fontSize: 56, marginBottom: 16 }}>💬</div>
      <p className="font-black text-[18px] mb-2" style={{ color: '#bbb' }}>Your messages</p>
      <p className="font-bold text-[14px]">Select a conversation to start chatting</p>
    </div>
  )
}
