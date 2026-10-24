declare namespace Cloudflare {
  interface Env {
    OPENAI_API_KEY?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Set to "true" when deployed outside OpenAI Sites: platform identity headers are then ignored. */
    AEKA_SELF_HOSTED?: string;
  }
}
