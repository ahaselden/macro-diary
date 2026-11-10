// File download via a temporary object URL (browser only).
export function download(name, text, type) {
  const blob = new Blob([text], { type }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
