import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotesPage } from "./NotesPage";
import { noteFormSchema } from "./schema";

const useQueryMock = vi.hoisted(() => vi.fn());
const addMock = vi.hoisted(() => vi.fn());
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery: useQueryMock,
  useMutation: () => addMock,
}));

describe("notes schema", () => {
  it("trims and enforces 1-500 characters", () => {
    expect(noteFormSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(noteFormSchema.safeParse({ text: "a".repeat(501) }).success).toBe(
      false,
    );
    expect(noteFormSchema.parse({ text: " ok " })).toEqual({ text: "ok" });
  });
});

describe("NotesPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    useQueryMock.mockReset();
    addMock.mockReset();
  });

  it("shows a Polish validation error on empty submit", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
    useQueryMock.mockReturnValue([]);
    render(<NotesPage />);
    await userEvent.click(
      screen.getByRole("button", { name: "Dodaj notatkę" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Wpisz treść notatki.",
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("submits a valid note and clears the field", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
    useQueryMock.mockReturnValue([]);
    addMock.mockResolvedValue("id");
    render(<NotesPage />);
    const input = screen.getByLabelText("Nowa notatka");
    await userEvent.type(input, "  Zadzwonić  ");
    await userEvent.click(
      screen.getByRole("button", { name: "Dodaj notatkę" }),
    );
    expect(addMock).toHaveBeenCalledWith({ text: "Zadzwonić" });
    expect(input).toHaveValue("");
  });

  it("renders the list from the query", () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://example.convex.cloud");
    useQueryMock.mockReturnValue([
      { _id: "1", text: "Pierwsza" },
      { _id: "2", text: "Druga" },
    ]);
    render(<NotesPage />);
    expect(screen.getByText("Pierwsza")).toBeInTheDocument();
    expect(screen.getByText("Druga")).toBeInTheDocument();
  });

  it("renders offline with validation and a disabled submit", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "");
    render(<NotesPage />);
    expect(useQueryMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Tryb offline: zapis jest wyłączony/),
    ).toBeVisible();
    const submit = screen.getByRole("button", { name: "Dodaj notatkę" });
    expect(submit).toBeDisabled();
    const input = screen.getByLabelText("Nowa notatka");
    await userEvent.type(input, "x");
    expect(submit).toBeDisabled();
    await userEvent.clear(input);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Wpisz treść notatki.",
    );
  });
});
