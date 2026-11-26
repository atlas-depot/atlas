import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/** Frozen parser shared by editor paths that inspect Markdown structure. */
export const markdownParser = unified().use(remarkParse).use(remarkGfm).freeze();
