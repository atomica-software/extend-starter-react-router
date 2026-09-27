import type { Route } from "./+types/_index";
import { type AddressBook, cz, CzApiError, CzNotConnectedError } from "../lib/cz.server";
import { Alert, Badge, Button, Card, CardHeader } from "../components/ui";
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
      const { data } = await cz(viewer).listAddressBooks({ team: viewer.team });
      books = { status: "ok", addressBooks: data };
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
        <h1 className="text-2xl font-semibold tracking-tight">Your Extend app</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          A starting point: edit <code className="font-mono">app/routes/_index.tsx</code>. UI components
          live in <code className="font-mono">app/components/ui</code>.
        </p>
      </header>

      <Card>
        <CardHeader title="Viewer" />
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
          title="Address books"
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
              <p className="text-gray-600 dark:text-gray-400">This team has no address books yet.</p>
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
            <Alert tone="warning" title="Contactzilla isn't connected">
              Ask an admin to reconnect from the Builder console.
            </Alert>
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
