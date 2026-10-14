"use client";

import { deleteUser } from "./actions";

// Destructive: confirm before submitting the delete action.
export function RemoveUserButton({ id, name }: { id: number; name: string }) {
  return (
    <form
      action={deleteUser.bind(null, id)}
      onSubmit={(e) => {
        if (!confirm(`Remove ${name}? This permanently deletes the account and cannot be undone.`)) {
          e.preventDefault();
        }
      }}
    >
      <button
        type="submit"
        className="rounded border border-status-expired/40 px-3 py-1 text-xs font-medium text-status-expired hover:bg-status-expired/10"
      >
        Remove
      </button>
    </form>
  );
}
