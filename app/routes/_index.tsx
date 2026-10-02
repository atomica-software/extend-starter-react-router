// The starter's demo page. `/` is the app's main screen: on the first build, replace this
// file's contents with the app itself (extend-starter-demo-page).
import type { Route } from "./+types/_index";
import { type AddressBook, appAddressBooks, CzApiError, CzNotConnectedError } from "../lib/cz.server";
import { Alert, Badge, Button, Card, CardHeader, NotConnectedAlert } from "../components/ui";
import { useExtendSdk } from "../lib/extend-sdk";
import { log } from "../lib/log.server";
import { getViewer } from "../lib/viewer.server";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Extend app" }];
}

type Books =
  | { status: "ok"; addressBooks: AddressBook[] }
  | { status: "no-viewer" }
  | { status: "not-connected"; message: string }
  | { status: "error"; message: string };

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = getViewer(request);
  let books: Books;

  if (!viewer || !viewer.team) {
    books = { status: "no-viewer" };
  } else {
    try {
      // The books the app is available in, of those this viewer can see.
      books = { status: "ok", addressBooks: await appAddressBooks(viewer) };
    } catch (error) {
      if (error instanceof CzNotConnectedError) {
        books = { status: "not-connected", message: error.message };
      } else if (error instanceof CzApiError) {
        // A recoverable problem: the page still renders. Log it with ids, never tokens or contact data.
        log.warn("Couldn't load address books", { error, team: viewer.team, viewer: viewer.id, status: error.status });
        books = {
          status: "error",
          message: error.status ? `${error.message} (HTTP ${error.status})` : error.message,
        };
      } else {
        throw error;
      }
    }
  }

  return { viewer, books };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { viewer, books } = loaderData;
  const sdk = useExtendSdk();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Your Extend app</h1>
          <Badge tone="amber">Replace this demo</Badge>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          This demo page is where your app goes. Describe what you need in the Builder, and it
          replaces this page with your app.
        </p>
      </header>

      <Card>
        <CardHeader title="Viewer (demo)" />
        {viewer ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-gray-500 dark:text-gray-400">Name</dt>
            <dd>{viewer.name || "—"}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Email</dt>
            <dd>{viewer.email || "—"}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Role</dt>
            <dd>
              <Badge tone={viewer.role === "admin" ? "green" : "gray"}>{viewer.role}</Badge>
            </dd>
            <dt className="text-gray-500 dark:text-gray-400">Team</dt>
            <dd className="font-mono">{viewer.team || "—"}</dd>
          </dl>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No viewer on this request. Inside Extend the edge proxy sets the{" "}
            <code className="font-mono">X-CZ-*</code> headers; when running locally, send them
            yourself (for example with <code className="font-mono">curl -H "X-CZ-User-Id: 1" -H "X-CZ-Team: acme"</code>).
          </p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Address books (demo)"
          actions={
            sdk.embedded && (
              <Button
                size="sm"
                onClick={() => sdk.toast({ message: "Hello from your Extend app", level: "success" })}
              >
                Say hello in Contactzilla
              </Button>
            )
          }
        />
        <div className="text-sm">
          {books.status === "ok" &&
            (books.addressBooks.length === 0 ? (
              <p className="text-gray-600 dark:text-gray-400">The app isn&apos;t available in any address book you can see.</p>
            ) : (
              <ul className="-my-2 divide-y divide-gray-200 dark:divide-gray-800">
                {books.addressBooks.map((book) => (
                  <li key={book.slug} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{book.name}</span>{" "}
                      <span className="font-mono text-xs text-gray-500">{book.slug}</span>
                    </span>
                    {typeof book.contact_count === "number" && (
                      <Badge>{book.contact_count} contacts</Badge>
                    )}
                  </li>
                ))}
              </ul>
            ))}
          {books.status === "no-viewer" && (
            <p className="text-gray-600 dark:text-gray-400">
              Address books load once a viewer and team are known.
            </p>
          )}
          {books.status === "not-connected" && (
            <NotConnectedAlert />
          )}
          {books.status === "error" && (
            <Alert tone="danger" title="Couldn't load address books">
              {books.message}
            </Alert>
          )}
        </div>
      </Card>
    </main>
  );
}
