import defineMessages from '@app/utils/defineMessages';
import { IssueType } from '@server/constants/issue';
import type { MessageDescriptor } from 'react-intl';

const messages = defineMessages('components.IssueModal', {
  issueAudio: 'Audio',
  issueVideo: 'Video',
  issueSubtitles: 'Subtitle',
  issueOther: 'Other',
  issueVideoHint: "Won't play, wrong version, or picture problems",
  issueAudioHint: 'No sound, wrong language, or audio out of sync',
  issueSubtitlesHint: 'Missing, wrong language, or out of sync subtitles',
  issueOtherHint: 'Wrong episode, metadata, or anything else',
});

interface IssueOption {
  name: MessageDescriptor;
  hint: MessageDescriptor;
  issueType: IssueType;
  mediaType?: 'movie' | 'tv';
}

export const issueOptions: IssueOption[] = [
  {
    name: messages.issueVideo,
    hint: messages.issueVideoHint,
    issueType: IssueType.VIDEO,
  },
  {
    name: messages.issueAudio,
    hint: messages.issueAudioHint,
    issueType: IssueType.AUDIO,
  },
  {
    name: messages.issueSubtitles,
    hint: messages.issueSubtitlesHint,
    issueType: IssueType.SUBTITLES,
  },
  {
    name: messages.issueOther,
    hint: messages.issueOtherHint,
    issueType: IssueType.OTHER,
  },
];
