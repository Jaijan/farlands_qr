import Link from 'next/link';
export function Brand() {
  return (
    <Link className="brand" href="/">
      <span className="brand-mark" aria-hidden="true" />
      FARLANDS<span style={{ color: 'var(--lime)', fontSize: 12 }}>®</span>
    </Link>
  );
}
