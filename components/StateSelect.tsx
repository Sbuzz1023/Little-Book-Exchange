import { US_STATES } from '@/lib/usStates'

type Props = {
  name: string
  defaultValue?: string
  required?: boolean
  placeholder: string
  className?: string
  style?: React.CSSProperties
}

// A plain <option value=""> placeholder — never disabled. Disabling it is a
// common footgun: browsers skip a disabled first option and auto-select the
// next one instead (silently landing on "Alabama"), which is worse than no
// placeholder at all. `required` alone is enough to block submission while
// the empty option is still selected.
export default function StateSelect({ name, defaultValue, required, placeholder, className, style }: Props) {
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ''}
      required={required}
      className={className}
      style={style}
    >
      <option value="">{placeholder}</option>
      {US_STATES.map(s => (
        <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
      ))}
    </select>
  )
}
