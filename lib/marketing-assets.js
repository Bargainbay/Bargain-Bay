// The marketing posters we have made, for the Marketing posters section on
// /admin/operations. NO imports: the component and the test both read it.
//
// Files live under public/marketing/ and are listed HERE, so adding a poster is
// "drop the files in, add a row". The test (test/marketing-assets.test.mjs) fails
// if a row points at a file that is not there, so the page cannot show a broken
// poster, and every animated poster needs a still, so the two stay paired.
//
// They are served as ordinary public files: this is marketing material we post
// publicly anyway, and the admin page is just where the team finds it.
const S = '/marketing/giveaway/stills';
const A = '/marketing/giveaway/animated';

const W = '/marketing/winner';
const H = '/marketing/halloween';
export const CAMPAIGNS = [
  {
    id: 'giveaway-2026-10',
    title: 'Thanksgiving freezer giveaway (October 2026)',
    note: 'Entries close Mon Oct 12, 11:59 pm ET. Draw Tue Oct 13. Link in bio / link sticker: bargainbay.ca/giveaway.',
    formats: [
      {
        id: 'feed', title: 'Feed posts', size: '4:5 · 1080 × 1350', note: 'Post the four as ONE carousel, in this order.',
        posters: [
          { id: 'feed-1', title: '1 · Announce', still: `${S}/feed-1-announce.jpg`, video: `${A}/feed-1-announce-animated.mp4` },
          { id: 'feed-2', title: '2 · How to enter', still: `${S}/feed-2-how-to-enter.jpg`, video: `${A}/feed-2-how-to-enter-animated.mp4` },
          { id: 'feed-3', title: '3 · Thankful video (+3)', still: `${S}/feed-3-thankful-video.jpg`, video: `${A}/feed-3-thankful-video-animated.mp4` },
          { id: 'feed-4', title: '4 · The fine print', still: `${S}/feed-4-fine-print.jpg`, video: `${A}/feed-4-fine-print-animated.mp4` }
        ]
      },
      {
        id: 'story', title: 'Stories & Reels', size: '9:16 · 1080 × 1920', note: 'Add a link sticker. The last one is for Sun Oct 11 and Mon Oct 12.',
        posters: [
          { id: 'story-1', title: '1 · Announce', still: `${S}/story-1-announce.jpg`, video: `${A}/story-1-announce-animated.mp4` },
          { id: 'story-2', title: '2 · How to enter', still: `${S}/story-2-how-to-enter.jpg`, video: `${A}/story-2-how-to-enter-animated.mp4` },
          { id: 'story-3', title: '3 · Last call', still: `${S}/story-3-last-call.jpg`, video: `${A}/story-3-last-call-animated.mp4` }
        ]
      }
    ],
    ads: [
      { id: 'ad-wide', title: 'Thanksgiving ad v2 (widescreen, 12 s, with sound)', note: 'Ice bin and tongs, everyone\'s glass. AI-generated: turn on the "AI info" label when posting. Also plays on /giveaway. No vertical (Reels) version of this one yet.',
        poster: '/giveaway/thanksgiving-ad-v2-poster.jpg', video: '/giveaway/thanksgiving-ad-v2.mp4' }
    ]
  },
  {
    id: 'giveaway-winner-2026-10',
    title: 'Thanksgiving giveaway winner (October 2026)',
    note: 'Tag @yimmer57. Still images only. The wordmark on these is generated: put the real logo over it in Canva if you want it exact.',
    formats: [
      { id: 'feed', title: 'Feed post', size: '4:5', note: 'Winner announcement.', posters: [
        { id: 'winner-feed', title: 'We have a winner', still: `${W}/winner-feed.jpg` }
      ] },
      { id: 'story', title: 'Story', size: '9:16', note: 'Add a link sticker to bargainbay.ca/giveaway.', posters: [
        { id: 'winner-story', title: 'We have a winner', still: `${W}/winner-story.jpg` }
      ] }
    ]
  },
  {
    id: 'giveaway-halloween-2026-10',
    title: 'Halloween giveaway: SMEG countertop oven (October 2026)',
    note: 'Entries Tue Oct 20 to Sat Oct 31, 11:59 pm ET. Costume photos judged Sun Nov 1, draw Mon Nov 2. Link in bio / link sticker: bargainbay.ca/giveaway. Still images only; the wordmark is generated, so put the real logo over it in Canva if you want it exact.',
    formats: [
      { id: 'feed', title: 'Feed posts', size: '4:5', note: 'Post the two as ONE carousel, in this order.', posters: [
        { id: 'hgive-feed-1', title: '1 · Announce', still: `${H}/giveaway-feed-1.jpg` },
        { id: 'hgive-feed-2', title: '2 · How to enter (+1 follow, +5 best costume)', still: `${H}/giveaway-feed-2.jpg` }
      ] },
      { id: 'story', title: 'Stories', size: '9:16', note: 'Add a link sticker. Last call is for Sat Oct 31.', posters: [
        { id: 'hgive-story-1', title: '1 · Announce', still: `${H}/giveaway-story-1.jpg` },
        { id: 'hgive-story-3', title: '3 · Last call', still: `${H}/giveaway-story-3.jpg` }
      ] }
    ]
  },
  {
    id: 'halloween-flash-2026-10',
    title: 'Halloween 31-hour flash (October 2026)',
    note: 'Teaser Thu Oct 29. The flash posters go up Fri Oct 30 at 5 pm and not before: the code BOO31 is a surprise. The coupon must exist in /admin/coupons first.',
    formats: [
      { id: 'feed', title: 'Feed post', size: '4:5', note: 'Fri Oct 30, 5 pm.', posters: [
        { id: 'flash-feed', title: '31 hours, $31 off', still: `${H}/flash-feed.jpg` }
      ] },
      { id: 'story', title: 'Stories', size: '9:16', note: 'Teaser first, then the flash.', posters: [
        { id: 'teaser-story', title: 'Teaser (no code)', still: `${H}/teaser-story.jpg` },
        { id: 'flash-story', title: '31 hours, $31 off', still: `${H}/flash-story.jpg` }
      ] }
    ]
  }
];

// Every file path a campaign refers to, for the test and for the count shown on the fold.
export function assetPaths(c) {
  const out = [];
  for (const f of c.formats) for (const p of f.posters) out.push(...[p.still, p.video].filter(Boolean));
  for (const a of c.ads || []) out.push(a.poster, a.video);
  return out;
}
export const posterCount = () => CAMPAIGNS.reduce((n, c) => n + c.formats.reduce((m, f) => m + f.posters.length, 0), 0);
