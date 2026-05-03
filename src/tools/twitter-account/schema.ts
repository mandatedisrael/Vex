import { z } from "zod";

const TWENTY_MAX = 20;
const HUNDRED_MAX = 100;

const NonEmptyString = z.string().trim().min(1);
const NumericId = NonEmptyString.regex(/^\d+$/, "must be a numeric Twitter/X id");
const Cursor = NonEmptyString.optional();
const Count20 = z.number().int().min(1).max(TWENTY_MAX).optional();
const Count100 = z.number().int().min(1).max(HUNDRED_MAX).optional();
const StringList = z.array(NonEmptyString).min(1).max(20).optional();
const IsoDate = z.string().datetime().optional();

const Username = NonEmptyString.transform((value) => (
  value.startsWith("@") ? value.slice(1) : value
)).pipe(
  z.string()
    .min(1)
    .max(15)
    .regex(/^[A-Za-z0-9_]+$/, "must be a Twitter/X username"),
);

const UserTarget = z
  .object({
    username: Username.optional(),
    userId: NumericId.optional(),
  })
  .refine((value) => value.username !== undefined || value.userId !== undefined, {
    message: "Provide `username` or `userId`",
  });

const TweetFilter = z
  .object({
    fromUsers: StringList,
    toUsers: StringList,
    mentions: StringList,
    hashtags: StringList,
    includeWords: StringList,
    optionalWords: StringList,
    excludeWords: StringList,
    includePhrase: NonEmptyString.optional(),
    language: z.string().trim().min(2).max(12).optional(),
    list: NonEmptyString.optional(),
    maxId: NumericId.optional(),
    sinceId: NumericId.optional(),
    quoted: NumericId.optional(),
    startDate: IsoDate,
    endDate: IsoDate,
    minLikes: z.number().int().min(0).optional(),
    minReplies: z.number().int().min(0).optional(),
    minRetweets: z.number().int().min(0).optional(),
    onlyLinks: z.boolean().optional(),
    onlyOriginal: z.boolean().optional(),
    onlyReplies: z.boolean().optional(),
    onlyText: z.boolean().optional(),
    top: z.boolean().optional(),
  })
  .strict()
  .refine((filter) => Object.keys(filter).length > 0, {
    message: "Provide at least one tweet search filter field",
  });

const WithCursor20 = z.object({ count: Count20, cursor: Cursor });
const WithCursor100 = z.object({ count: Count100, cursor: Cursor });

export const TwitterAccountParamsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("account_status") }),
  z.object({ action: z.literal("tweet_details"), tweetId: NumericId }),
  z.object({ action: z.literal("tweet_search"), filter: TweetFilter, count: Count20, cursor: Cursor }),
  z.object({
    action: z.literal("tweet_replies"),
    tweetId: NumericId,
    cursor: Cursor,
    sortBy: z.enum(["LATEST", "LIKES", "RELEVANCE"]).optional(),
  }),
  z.object({ action: z.literal("tweet_likers"), tweetId: NumericId }).merge(WithCursor100),
  z.object({ action: z.literal("tweet_retweeters"), tweetId: NumericId }).merge(WithCursor100),
  z.object({
    action: z.literal("space_details"),
    spaceId: NonEmptyString,
    withReplays: z.boolean().optional(),
    withListeners: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("user_details"),
  }).merge(UserTarget),
  z.object({ action: z.literal("user_search"), query: NonEmptyString }).merge(WithCursor20),
  z.object({ action: z.literal("user_timeline") }).merge(UserTarget).merge(WithCursor20),
  z.object({ action: z.literal("user_replies") }).merge(UserTarget).merge(WithCursor20),
  z.object({ action: z.literal("user_followers") }).merge(UserTarget).merge(WithCursor100),
  z.object({ action: z.literal("user_following") }).merge(UserTarget).merge(WithCursor100),
]);

export type TwitterAccountParams = z.infer<typeof TwitterAccountParamsSchema>;
