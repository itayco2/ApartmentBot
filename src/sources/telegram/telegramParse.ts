import * as cheerio from 'cheerio';

export interface ChannelPost {
  /** `<channel>/<message number>` - Telegram's own id, and the dedupe key. */
  id: string;
  url: string;
  text: string;
  postedAt?: Date;
  /** First photo, when the post has one and it is served over https. */
  photo?: string;
}

export interface ChannelPage {
  title?: string;
  posts: ChannelPost[];
}

/**
 * Reads the posts off a t.me/s/<channel> page.
 *
 * The page is plain server-rendered HTML: each post is a
 * `.tgme_widget_message` carrying `data-post="channel/1234"`, a `<time
 * datetime>` in its footer, its text in `.tgme_widget_message_text`, and its
 * photos as `background-image` styles rather than `<img>` tags - which is why
 * the generic text reducer cannot be pointed at it directly.
 */
export function parseChannelPage(html: string, channel: string): ChannelPage {
  const $ = cheerio.load(html);
  const title = $('.tgme_channel_info_header_title').first().text().trim() || undefined;

  const posts: ChannelPost[] = [];
  $('.tgme_widget_message[data-post]').each((_, element) => {
    const message = $(element);
    const id = message.attr('data-post')?.trim();
    if (!id) return;

    // Media posts render the caption twice; the first copy is the caption.
    const text = message.find('.tgme_widget_message_text').first().text().replace(/\s+/g, ' ').trim();
    if (!text) return;

    const datetime = message.find('time[datetime]').first().attr('datetime');
    const postedAt = datetime ? new Date(datetime) : undefined;

    const style = message.find('.tgme_widget_message_photo_wrap').first().attr('style') ?? '';
    const photo = /background-image:\s*url\('?(https:\/\/[^')]+)'?\)/.exec(style)?.[1];

    posts.push({
      id,
      url: `https://t.me/${channel}/${id.split('/')[1] ?? ''}`,
      text,
      ...(postedAt && !Number.isNaN(postedAt.getTime()) ? { postedAt } : {}),
      ...(photo ? { photo } : {}),
    });
  });

  return { ...(title ? { title } : {}), posts };
}
