import { redirect } from "next/navigation";

// Clients moved to their own top-level section. Keeps old links and bookmarks alive.
export default function MovedClientsPage() {
  redirect("/clients");
}
