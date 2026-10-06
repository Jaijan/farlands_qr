'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="public-shell center">
      <h1>Something interrupted the connection.</h1>
      <p>Please try again. No movement is confirmed without a server response.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
