// Button in the Krillion style.
//
// variant: "primary" (cyan border, dark fill) | "danger" (pink fill)
//          | "ghost" (quiet, for HUD) | "option" (left-aligned answer choice)
// size:    "sm" | "md" | "lg" (lg fills the width, like BEGIN DESCENT)
export default function PixelButton({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  ...rest
}) {
  return <button type={type} className={`pbtn pbtn--${variant} pbtn--${size} ${className}`} {...rest} />
}
