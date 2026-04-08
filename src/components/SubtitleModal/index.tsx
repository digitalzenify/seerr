import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import useClickOutside from '@app/hooks/useClickOutside';
import { useLockBodyScroll } from '@app/hooks/useLockBodyScroll';
import defineMessages from '@app/utils/defineMessages';
import {
  LanguageIcon,
  XMarkIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';
import { Transition } from '@headlessui/react';
import { Fragment, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';
import useSWR from 'swr';

const messages = defineMessages('components.SubtitleModal', {
  downloadSubtitle: 'Download Subtitle',
  noSubtitles: 'No subtitles available for this language.',
  subtitleRequested:
    'Subtitle download has been triggered. Please try again in a moment.',
  subtitleNotFound: 'No subtitle found for this language.',
  downloadError: 'Download failed. Please try again.',
  hearingImpaired: 'Hearing Impaired',
  forced: 'Forced',
  defaultTrack: 'Default',
  english: 'English',
  romanian: 'Romanian',
  matchScore: 'Score: {score}',
});

interface SubtitleStream {
  index: number;
  language: string;
  displayTitle: string;
  codec: string;
  isForced: boolean;
  isDefault: boolean;
  isExternal: boolean;
  isHearingImpaired: boolean;
  source: string;
  matchScore?: number;
}

interface SubtitleModalProps {
  show: boolean;
  onClose: () => void;
  mediaId: number;
  // For episodes
  seasonNumber?: number;
  episodeNumber?: number;
}

const LANGUAGES = [
  { code: 'eng', label: 'english' as const, iso: 'en' },
  { code: 'rum', label: 'romanian' as const, iso: 'ro' },
];

const SubtitleModal = ({
  show,
  onClose,
  mediaId,
  seasonNumber,
  episodeNumber,
}: SubtitleModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [selectedLang, setSelectedLang] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useLockBodyScroll(show);
  useClickOutside(modalRef, () => {
    if (show) onClose();
  });

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Build the correct API URL based on movie vs episode
  const apiUrl =
    seasonNumber != null && episodeNumber != null
      ? `/api/v1/media/${mediaId}/episode/${seasonNumber}/${episodeNumber}/subtitle-streams`
      : `/api/v1/media/${mediaId}/subtitle-streams`;

  const { data, error } = useSWR<{ streams: SubtitleStream[] }>(
    show ? apiUrl : null
  );

  const isLoading = show && !data && !error;

  const currentLangCode = LANGUAGES[selectedLang].code;
  const filteredStreams =
    data?.streams?.filter((s) => s.language === currentLangCode) ?? [];

  const handleDownload = async (language: string) => {
    const downloadUrl =
      seasonNumber != null && episodeNumber != null
        ? `/api/v1/media/${mediaId}/episode/${seasonNumber}/${episodeNumber}/subtitle/${language}/download`
        : `/api/v1/media/${mediaId}/subtitle/${language}/download`;

    try {
      const response = await fetch(downloadUrl);

      if (response.status === 202) {
        addToast(intl.formatMessage(messages.subtitleRequested), {
          appearance: 'info',
          autoDismiss: true,
        });
        return;
      }

      if (!response.ok) {
        addToast(intl.formatMessage(messages.subtitleNotFound), {
          appearance: 'warning',
          autoDismiss: true,
        });
        return;
      }

      const disposition = response.headers.get('content-disposition');
      let filename = `subtitle-${language}.srt`;
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match?.[1]) {
          filename = match[1];
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      onClose();
    } catch {
      addToast(intl.formatMessage(messages.downloadError), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  if (!isMounted) return null;

  return ReactDOM.createPortal(
    <Transition as={Fragment} show={show} appear>
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="transition-opacity duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-900/70" />
        </Transition.Child>

        {/* Modal panel - bottom sheet on mobile, centered on desktop */}
        <Transition.Child
          as={Fragment}
          enter="transition duration-300 ease-out"
          enterFrom="translate-y-full opacity-0 sm:translate-y-0 sm:scale-95"
          enterTo="translate-y-0 opacity-100 sm:scale-100"
          leave="transition duration-200 ease-in"
          leaveFrom="translate-y-0 opacity-100 sm:scale-100"
          leaveTo="translate-y-full opacity-0 sm:translate-y-0 sm:scale-95"
        >
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={intl.formatMessage(messages.downloadSubtitle)}
            className="relative z-10 w-full max-w-lg rounded-t-2xl bg-gray-800 shadow-xl ring-1 ring-gray-700 sm:rounded-2xl"
            style={{ maxHeight: '80vh' }}
          >
            {/* Drag handle for mobile */}
            <div className="flex justify-center pt-2 sm:hidden">
              <div className="h-1 w-10 rounded-full bg-gray-600" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3 sm:px-6 sm:py-4">
              <div className="flex items-center gap-2">
                <LanguageIcon className="h-5 w-5 text-indigo-400" />
                <h2 className="text-lg font-bold text-white">
                  {intl.formatMessage(messages.downloadSubtitle)}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-700 hover:text-white"
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            {/* Language tabs */}
            <div className="flex border-b border-gray-700 px-4 sm:px-6">
              {LANGUAGES.map((lang, idx) => (
                <button
                  key={lang.code}
                  onClick={() => setSelectedLang(idx)}
                  className={`flex-1 py-2.5 text-center text-sm font-medium transition ${
                    selectedLang === idx
                      ? 'border-b-2 border-indigo-400 text-indigo-400'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {intl.formatMessage(messages[lang.label])}
                </button>
              ))}
            </div>

            {/* Subtitle list */}
            <div
              className="hide-scrollbar overflow-y-auto px-4 py-3 sm:px-6"
              style={{ maxHeight: 'calc(80vh - 140px)' }}
            >
              {isLoading ? (
                <div className="flex justify-center py-8">
                  <LoadingSpinner />
                </div>
              ) : filteredStreams.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <LanguageIcon className="mb-3 h-10 w-10 text-gray-600" />
                  <p className="text-sm text-gray-400">
                    {intl.formatMessage(messages.noSubtitles)}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredStreams.map((stream) => (
                    <button
                      key={stream.index}
                      onClick={() => handleDownload(currentLangCode)}
                      className="group flex w-full items-center gap-3 rounded-xl bg-gray-750 p-3 text-left transition hover:bg-gray-700 active:bg-gray-600 sm:p-4"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
                        <ArrowDownTrayIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-xs font-medium text-indigo-300">
                            {stream.source}
                          </span>
                          {stream.isHearingImpaired && (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-300">
                              {intl.formatMessage(messages.hearingImpaired)}
                            </span>
                          )}
                          {stream.isForced && (
                            <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-xs font-medium text-purple-300">
                              {intl.formatMessage(messages.forced)}
                            </span>
                          )}
                          {stream.isDefault && (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-medium text-emerald-300">
                              {intl.formatMessage(messages.defaultTrack)}
                            </span>
                          )}
                          {stream.matchScore != null && (
                            <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-xs font-medium text-cyan-300">
                              {intl.formatMessage(messages.matchScore, {
                                score: stream.matchScore,
                              })}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-sm text-gray-300">
                          {stream.displayTitle}
                        </p>
                        {stream.codec && (
                          <p className="text-xs text-gray-500">
                            {stream.codec.toUpperCase()}
                          </p>
                        )}
                      </div>
                      <ArrowDownTrayIcon className="h-4 w-4 shrink-0 text-gray-500 transition group-hover:text-indigo-400" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Transition.Child>
      </div>
    </Transition>,
    document.body
  );
};

export default SubtitleModal;
