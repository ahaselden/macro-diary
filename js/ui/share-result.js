// Share text via the share sheet / clipboard and toast when it was copied.
import { toast } from '../core/dom.js';
import { shareText } from '../services/share.js';

export const shareResult = async (text, title) => { if (await shareText(text, title) === 'copied') toast('Copied to clipboard'); };
