import { Alert } from "./Alert";

/**
 * What a page shows when Contactzilla isn't connected (a loader caught
 * CzNotConnectedError). Only an admin can fix it, from the Builder console.
 */
export function NotConnectedAlert({ className }: { className?: string }) {
  return (
    <Alert tone="warning" title="Contactzilla isn't connected" className={className}>
      Ask an admin to reconnect from the Builder console.
    </Alert>
  );
}
