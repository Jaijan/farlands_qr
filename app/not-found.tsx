import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="public-shell center">
      <h1>Page not found.</h1>
      <Link className="button" href="/">
        Return to Farlands
      </Link>
    </main>
  );
}
