// Chunky "pressable" pixel key: ink outline and a hard bottom shadow that
// compresses when pressed.
//
// variant: "primary" (carrot) | "secondary" (cream) | "reply" (chat quick-reply chip)
//          | "ghost" (quiet, for the HUD)
// size:    "sm" | "md" | "lg" (lg fills the width)
export default function PixelButton({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className = '',
  ...rest
}) {
  return <button type={type} className={`pbtn pbtn--${variant} pbtn--${size} ${className}`} {...rest} />
}
