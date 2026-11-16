import { z } from "zod";

export const MAX_NOTE_LENGTH = 500;

export const noteFormSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Wpisz treść notatki.")
    .max(
      MAX_NOTE_LENGTH,
      `Notatka może mieć najwyżej ${MAX_NOTE_LENGTH} znaków.`,
    ),
});

export type NoteForm = z.infer<typeof noteFormSchema>;
