// Dark panel with notched pixel corners and a glowing border.
//
// tone:  "accent" (cyan, default) | "danger" (pink) | "gold" | "plain" (no glow)
// tag:   optional badge sitting on the top border, e.g. "UNEARTHED"
// label: optional small wide-tracked heading inside, e.g. "LAYER 2"
export default function Panel({
  tone = 'accent',
  tag,
  label,
  className = '',
  as: Tag = 'section',
  children,
  ...rest
}) {
  return (
    <Tag className={`panel panel--${tone} ${tag ? 'panel--tagged' : ''} ${className}`} {...rest}>
      {tag && <span className="panel__tag">{tag}</span>}
      <div className="panel__frame">
        <div className="panel__body">
          {label && <p className="panel__label">{label}</p>}
          {children}
        </div>
      </div>
    </Tag>
  )
}
