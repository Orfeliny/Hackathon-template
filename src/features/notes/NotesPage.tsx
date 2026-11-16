import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Card } from "../../components/ui/Card";
import { getEnv } from "../../lib/env";
import { NoteForm } from "./NoteForm";

function OnlineNotes() {
  const notes = useQuery(api.notes.queries.list);
  const add = useMutation(api.notes.mutations.add);
  return (
    <>
      <NoteForm
        offline={false}
        onSubmit={async ({ text }) => {
          await add({ text });
        }}
      />
      {notes === undefined ? (
        <p>Ładowanie notatek…</p>
      ) : notes.length === 0 ? (
        <p>Brak notatek.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note._id}>
              <Card>{note.text}</Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function NotesPage() {
  const online = getEnv().convexUrl !== undefined;
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Notatki</h1>
      {online ? (
        <OnlineNotes />
      ) : (
        <NoteForm offline onSubmit={() => Promise.resolve()} />
      )}
    </section>
  );
}
