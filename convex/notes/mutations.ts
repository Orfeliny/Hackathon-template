import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";

const MAX_TEXT_LENGTH = 500;

export const add = mutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const text = args.text.trim();
    if (text.length < 1 || text.length > MAX_TEXT_LENGTH) {
      throw new ConvexError(
        `Note text must be 1-${MAX_TEXT_LENGTH} characters after trimming`,
      );
    }
    return await ctx.db.insert("notes", { text, createdAt: Date.now() });
  },
});
