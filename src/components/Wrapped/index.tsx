import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import { useUser } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type {
  UserWrappedLockedResponse,
  UserWrappedResponse,
} from '@server/interfaces/api/userInterfaces';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Wrapped', {
  title: 'Wrapped',
  unlockedTomorrow: 'Your year, unwrapped.',
  lockedBody:
    'Everything you watched this year — the shows, the hours, the late-night decisions — is being counted.',
  opensAt: 'Opens for everyone at the same moment. One page per person.',
  days: 'days',
  hrs: 'hrs',
  min: 'min',
  sec: 'sec',
  yearCard: 'Your year',
  hoursWatched: 'hours watched',
  openedOn: 'You opened something on {days} days this year.',
  hoursBreakdown: 'That is {days} full days, {percent}% of your year.',
  acrossPlays: 'Across {plays} plays, {shows} shows and {movies} films.',
  yourShow: 'Your show',
  wentBackTo: 'You went back to',
  episodesHours: '{episodes} episodes · {hours} hours',
  showShare: '{percent}% of everything you played this year was this one show.',
  yourTaste: 'Your taste',
  topFive: 'Top 5',
  genreIntro: 'Share of your plays that carried each genre.',
  genreNote:
    'Measured per play, not per minute. A drama you finished counts like a comedy you left early.',
  worstNight: 'Your worst night',
  oneSitting: 'One sitting. No breaks recorded.',
  episodes: 'episodes',
  backToBack: '{show}, back to back.',
  bingeNote: 'Nobody counted, nobody judged. Tautulli did both.',
  yourStreak: 'Your streak',
  bestOfYear: 'Best of the year',
  consecutiveDays: 'Consecutive days you opened something.',
  daysInARow: 'days in a row',
  streakStart: 'Started {date}. Longest run of the year.',
  yourClock: 'Your clock',
  screenTurnsOn: 'Your screen turns on, mostly, at',
  sessionNote:
    'Average session {minutes} minutes. Busiest day: {date}, {hours}h {mins}m.',
  yourCompany: 'Your company',
  mostSeen: 'Most seen',
  facesIntro: 'The faces you spent the year with.',
  facesNote:
    'Counted from the cast of every title you played, weighted by plays.',
  yourFilms: 'Your films',
  titles: '{count} titles',
  filmsNote:
    '{plays} film plays against {episodes} episodes — you are a series person.',
  noRepeatFilm: 'Not one of them twice.',
  yourType: 'Your type',
  basedOn: 'Based on everything above, you are',
  shareNote: 'Share this card. Nobody can argue with the data.',
  fourNumbers: "{name}'s year, in four numbers.",
  hours: 'Hours',
  plays: 'Plays',
  daysActive: 'Days active',
  bestStreak: 'Best streak',
  firstPlay: 'Your first play of the year: {title}, {date}.',
  finale: 'See you in 2027.',
  empty: 'Nothing watched in {year} yet.',
  emptyBody:
    'Once you start watching, this page fills up. The wrapped is composed from your own play history, not the whole server.',
  somethingWrong: 'Something went wrong fetching your wrapped.',
});

const PAPER = 'text-[#F5EFE6]';
const MUTED = 'text-[rgba(245,239,230,0.55)]';
const FAINT = 'text-[rgba(245,239,230,0.42)]';

interface Props {
  userId?: number;
}

const Card = ({
  children,
  className = '',
  glow = true,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) => (
  <section
    className={`relative flex min-h-[600px] flex-col overflow-hidden rounded-[22px] bg-[#0A0908] p-7 ${className}`}
  >
    {glow && (
      <div
        className="pointer-events-none absolute inset-x-[-30%] top-[-20%] h-[70%]"
        style={{
          background:
            'radial-gradient(60% 70% at 70% 20%, rgba(255,176,32,.22), transparent 70%)',
        }}
      />
    )}
    {children}
  </section>
);

const Eyebrow = ({
  left,
  right,
  dark = false,
}: {
  left: string;
  right: string;
  dark?: boolean;
}) => (
  <div
    className={`relative z-10 flex items-baseline justify-between text-[11px] uppercase tracking-[0.1em] ${
      dark ? 'text-[rgba(23,13,2,0.62)]' : FAINT
    }`}
  >
    <span>{left}</span>
    <span className="font-semibold">{right}</span>
  </div>
);

const Foot = ({
  children,
  dark = false,
}: {
  children: ReactNode;
  dark?: boolean;
}) => (
  <div
    className={`relative z-10 mt-4 max-w-[34ch] border-t pt-3 text-[12.5px] leading-relaxed ${
      dark
        ? 'border-[rgba(23,13,2,0.2)] text-[rgba(23,13,2,0.62)]'
        : 'border-[rgba(245,239,230,0.12)] text-[rgba(245,239,230,0.5)]'
    }`}
  >
    {children}
  </div>
);

const Locked = ({
  data,
  locale,
}: {
  data: UserWrappedLockedResponse;
  locale: string;
}) => {
  const intl = useIntl();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const unlock = new Date(data.unlocksAt);
  const ms = Math.max(0, unlock.getTime() - now);
  const parts = [
    { value: Math.floor(ms / 86400000), label: messages.days },
    { value: Math.floor((ms % 86400000) / 3600000), label: messages.hrs },
    { value: Math.floor((ms % 3600000) / 60000), label: messages.min },
    { value: Math.floor((ms % 60000) / 1000), label: messages.sec },
  ];
  const pad = (n: number) => String(n).padStart(2, '0');
  const month = new Intl.DateTimeFormat(locale, { month: 'long' }).format(
    unlock
  );
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(unlock);

  return (
    <Card className="justify-start">
      <Eyebrow
        left={intl.formatMessage(messages.title)}
        right={String(data.year)}
      />

      <div className="relative z-10 mb-auto mt-auto">
        <div className="flex items-start gap-3">
          <div className="text-[150px] font-[800] tabular-nums leading-[0.78] tracking-[-0.07em] text-[#FFB020]">
            {unlock.getDate()}
          </div>
          <div className="pt-2 text-[13px] uppercase leading-relaxed tracking-[0.16em] text-[rgba(245,239,230,0.55)]">
            {month}
            <br />
            {time}
          </div>
        </div>

        <h2
          className={`mt-6 text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] ${PAPER}`}
        >
          {intl.formatMessage(messages.unlockedTomorrow)}
        </h2>
        <p className={`mt-3 max-w-[29ch] text-[14px] leading-relaxed ${MUTED}`}>
          {intl.formatMessage(messages.lockedBody)}
        </p>
      </div>

      <div className="relative z-10 flex w-full gap-2">
        {parts.map((part) => (
          <div
            key={part.label.id}
            className="flex-1 rounded-[10px] border border-[rgba(245,239,230,0.12)] bg-[rgba(245,239,230,0.06)] px-1 pb-2 pt-2.5 text-center"
          >
            <span className="block text-[24px] font-bold tabular-nums">
              {pad(part.value)}
            </span>
            <span className="mt-1 block text-[9.5px] uppercase tracking-[0.14em] text-[rgba(245,239,230,0.4)]">
              {intl.formatMessage(part.label)}
            </span>
          </div>
        ))}
      </div>

      <Foot>{intl.formatMessage(messages.opensAt)}</Foot>
    </Card>
  );
};

const Wrapped = ({ userId }: Props) => {
  const intl = useIntl();
  const { user } = useUser();
  const targetId = userId ?? user?.id;

  const { data, error } = useSWR<
    UserWrappedResponse | UserWrappedLockedResponse
  >(targetId ? `/api/v1/user/${targetId}/wrapped` : null);

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  if (!data) {
    return <LoadingSpinner />;
  }

  if ('locked' in data && data.locked) {
    return (
      <div className="mb-8 mt-4 flex justify-center">
        <div className="w-full max-w-[430px]">
          <Locked data={data} locale={intl.locale} />
        </div>
      </div>
    );
  }

  const w = data as UserWrappedResponse;
  const day = (iso: string) =>
    new Intl.DateTimeFormat(intl.locale, {
      day: 'numeric',
      month: 'long',
    }).format(new Date(`${iso}T12:00:00`));
  const hour = `${String(w.peakHour).padStart(2, '0')}:00`;
  const maxPlays = Math.max(...w.peakHourPlays, 1);
  const busiest = w.busiestDay;

  if (!w.plays) {
    return (
      <div className="mb-8 mt-4 flex justify-center">
        <div className="w-full max-w-[430px]">
          <Card>
            <Eyebrow
              left={intl.formatMessage(messages.title)}
              right={String(w.year)}
            />
            <div className="relative z-10 my-auto">
              <h2
                className={`text-[30px] font-extrabold leading-tight ${PAPER}`}
              >
                {intl.formatMessage(messages.empty, { year: w.year })}
              </h2>
              <p className={`mt-3 text-[14px] leading-relaxed ${MUTED}`}>
                {intl.formatMessage(messages.emptyBody)}
              </p>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-10 mt-4 flex justify-center">
      <div className="w-full max-w-[430px] space-y-3">
        {/* 01 — year */}
        <Card>
          <Eyebrow
            left={`01 — ${intl.formatMessage(messages.yearCard)}`}
            right={user?.displayName ?? ''}
          />
          <div className="relative z-10 mt-auto">
            <p className="text-[15px] leading-relaxed text-[rgba(245,239,230,0.62)]">
              {intl.formatMessage(messages.openedOn, { days: w.daysActive })}
            </p>
            <div className="mt-2 flex items-end gap-3">
              <span className="text-[104px] font-extrabold tabular-nums leading-[0.82] tracking-[-0.05em] text-[#FFB020]">
                {w.hours}
              </span>
              <span className="pb-4 text-[13px] font-semibold uppercase tracking-[0.14em] text-[rgba(245,239,230,0.5)]">
                {intl.formatMessage(messages.hoursWatched)}
              </span>
            </div>
            <p className="mt-4 text-[15px] leading-relaxed text-[rgba(245,239,230,0.62)]">
              {intl.formatMessage(messages.hoursBreakdown, {
                days: (w.hours / 24).toFixed(1),
                percent: Math.round((w.hours / (365 * 24)) * 1000) / 10,
              })}
            </p>
          </div>
          <Foot>
            {intl.formatMessage(messages.acrossPlays, {
              plays: w.plays,
              shows: w.uniqueShows,
              movies: w.uniqueMovies,
            })}
          </Foot>
        </Card>

        {/* 02 — top show */}
        {w.topShow && (
          <Card className="p-0" glow={false}>
            {w.topShow.ratingKey && (
              <img
                src={`/imageproxy/plex/${w.topShow.ratingKey}`}
                alt=""
                className="absolute -right-[16%] top-[6%] h-[88%] w-[78%] rotate-[3.5deg] rounded-md object-cover opacity-95"
              />
            )}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(10,9,8,.55) 0%, rgba(10,9,8,.1) 35%, rgba(10,9,8,.92) 78%, #0A0908 100%), linear-gradient(90deg, rgba(10,9,8,.95) 20%, rgba(10,9,8,0) 70%)',
              }}
            />
            <div className="relative z-10 flex h-full flex-col p-7">
              <Eyebrow
                left={`02 — ${intl.formatMessage(messages.yourShow)}`}
                right="#1"
              />
              <div className="mt-auto">
                <p className={`text-[15px] ${MUTED}`}>
                  {intl.formatMessage(messages.wentBackTo)}
                </p>
                <h2
                  className={`mt-2 max-w-[11ch] text-[42px] font-extrabold leading-[0.94] tracking-[-0.03em] ${PAPER}`}
                >
                  {w.topShow.title}
                </h2>
                <p className={`mt-4 text-[15px] ${MUTED}`}>
                  {intl.formatMessage(messages.episodesHours, {
                    episodes: w.topShow.episodes,
                    hours: w.topShow.hours,
                  })}
                </p>
              </div>
              <Foot>
                {intl.formatMessage(messages.showShare, {
                  percent: w.topShow.share,
                })}
              </Foot>
            </div>
          </Card>
        )}

        {/* 03 — genres */}
        <Card>
          <Eyebrow
            left={`03 — ${intl.formatMessage(messages.yourTaste)}`}
            right={intl.formatMessage(messages.topFive)}
          />
          <div className="relative z-10 mt-auto">
            <p className={`mb-5 text-[15px] ${MUTED}`}>
              {intl.formatMessage(messages.genreIntro)}
            </p>
            <div className="flex flex-col gap-5">
              {w.genres.map((genre, index) => (
                <div
                  key={genre.name}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-x-2.5 gap-y-1"
                >
                  <span
                    className={`text-[16px] font-semibold ${PAPER}`}
                    style={index === 0 ? { color: '#FFB020' } : undefined}
                  >
                    {genre.name}
                  </span>
                  <span className="text-[12px] tabular-nums text-[rgba(245,239,230,0.45)]">
                    {genre.share}%
                  </span>
                  <span className="col-span-2 h-[9px] overflow-hidden rounded-full bg-[rgba(245,239,230,0.11)]">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.min(100, genre.share)}%`,
                        background:
                          index === 0
                            ? '#FFB020'
                            : `rgba(255,176,32,${(0.55 - index * 0.09).toFixed(2)})`,
                      }}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>
          <Foot>{intl.formatMessage(messages.genreNote)}</Foot>
        </Card>

        {/* 04 — binge */}
        {w.longestBinge && (
          <Card
            className="bg-[linear-gradient(160deg,#E4572E_0%,#B33A18_100%)] text-[#1A0C05]"
            glow={false}
          >
            <Eyebrow
              left={`04 — ${intl.formatMessage(messages.worstNight)}`}
              right={day(w.longestBinge.date)}
              dark
            />
            <div className="relative z-10 mt-auto">
              <p className="text-[15px] text-[rgba(26,12,5,0.62)]">
                {intl.formatMessage(messages.oneSitting)}
              </p>
              <div className="mt-2 flex items-end gap-3">
                <span className="text-[104px] font-extrabold tabular-nums leading-[0.82] tracking-[-0.05em]">
                  {w.longestBinge.episodes}
                </span>
                <span className="pb-4 text-[13px] font-semibold uppercase tracking-[0.14em] text-[rgba(26,12,5,0.6)]">
                  {intl.formatMessage(messages.episodes)}
                </span>
              </div>
              <div className="mt-5 flex items-end gap-1.5">
                {Array.from({
                  length: Math.min(12, w.longestBinge.episodes),
                }).map((_, i) => (
                  <span
                    key={i}
                    className="block w-5 rounded-sm bg-[rgba(26,12,5,0.28)]"
                    style={{ height: i % 2 ? 26 : 34 }}
                  />
                ))}
              </div>
              <p className="mt-4 text-[15px] text-[rgba(26,12,5,0.62)]">
                {intl.formatMessage(messages.backToBack, {
                  show: w.longestBinge.show,
                })}
              </p>
            </div>
            <Foot dark>{intl.formatMessage(messages.bingeNote)}</Foot>
          </Card>
        )}

        {/* 05 — streak */}
        {w.longestStreak && (
          <Card>
            <Eyebrow
              left={`05 — ${intl.formatMessage(messages.yourStreak)}`}
              right={intl.formatMessage(messages.bestOfYear)}
            />
            <div className="relative z-10 mt-auto">
              <p className={`text-[15px] ${MUTED}`}>
                {intl.formatMessage(messages.consecutiveDays)}
              </p>
              <div className="mt-2 flex items-end gap-3">
                <span className="text-[104px] font-extrabold tabular-nums leading-[0.82] tracking-[-0.05em] text-[#FFB020]">
                  {w.longestStreak.days}
                </span>
                <span className="pb-4 text-[13px] font-semibold uppercase tracking-[0.14em] text-[rgba(245,239,230,0.5)]">
                  {intl.formatMessage(messages.daysInARow)}
                </span>
              </div>
              <div className="mt-6 grid max-w-[250px] grid-cols-7 gap-1.5">
                {Array.from({ length: Math.min(21, w.longestStreak.days) }).map(
                  (_, i) => (
                    <span
                      key={i}
                      className="aspect-square rounded-full bg-[#FFB020]"
                    />
                  )
                )}
              </div>
            </div>
            <Foot>
              {intl.formatMessage(messages.streakStart, {
                date: day(w.longestStreak.start),
              })}
            </Foot>
          </Card>
        )}

        {/* 06 — clock */}
        <Card>
          <Eyebrow
            left={`06 — ${intl.formatMessage(messages.yourClock)}`}
            right={w.peakWeekday ?? ''}
          />
          <div className="relative z-10 mt-auto">
            <p className={`text-[15px] ${MUTED}`}>
              {intl.formatMessage(messages.screenTurnsOn)}
            </p>
            <div className="mt-2 text-[104px] font-extrabold tabular-nums leading-[0.82] tracking-[-0.05em]">
              {hour}
            </div>
            <div className="mt-5 flex h-[96px] items-end gap-[3px]">
              {w.peakHourPlays.map((plays, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-t-sm"
                  style={{
                    height: `${Math.max(3, Math.round((plays / maxPlays) * 100))}%`,
                    background:
                      i === w.peakHour ? '#FFB020' : 'rgba(245,239,230,0.14)',
                  }}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[10px] uppercase tracking-[0.08em] text-[rgba(245,239,230,0.35)]">
              <span>00</span>
              <span>06</span>
              <span>12</span>
              <span>18</span>
              <span>23</span>
            </div>
          </div>
          {busiest && (
            <Foot>
              {intl.formatMessage(messages.sessionNote, {
                minutes: w.averageSessionMinutes,
                date: day(busiest.date),
                hours: Math.floor(busiest.minutes / 60),
                mins: busiest.minutes % 60,
              })}
            </Foot>
          )}
        </Card>

        {/* 07 — company */}
        {w.actors.length > 0 && (
          <Card className="bg-[#F5EFE6] text-[#141210]" glow={false}>
            <Eyebrow
              left={`07 — ${intl.formatMessage(messages.yourCompany)}`}
              right={intl.formatMessage(messages.mostSeen)}
              dark
            />
            <div className="relative z-10 mt-auto">
              <p className="text-[15px] text-[rgba(20,18,16,0.55)]">
                {intl.formatMessage(messages.facesIntro)}
              </p>
              <div className="mt-3 flex flex-col gap-0.5">
                {w.actors.map((actor, i) => (
                  <div
                    key={actor}
                    className="text-[30px] font-extrabold leading-tight tracking-[-0.03em]"
                    style={i === 0 ? { color: '#A8340F' } : undefined}
                  >
                    {actor}
                  </div>
                ))}
              </div>
            </div>
            <Foot dark>{intl.formatMessage(messages.facesNote)}</Foot>
          </Card>
        )}

        {/* 08 — films */}
        <Card>
          <Eyebrow
            left={`08 — ${intl.formatMessage(messages.yourFilms)}`}
            right={intl.formatMessage(messages.titles, {
              count: w.uniqueMovies,
            })}
          />
          <div className="relative z-10 mt-auto">
            <p className={`mb-4 text-[15px] ${MUTED}`}>
              {`${w.uniqueMovies} films, ${w.moviePlays} plays. `}
              {w.moviePlays === w.uniqueMovies &&
                intl.formatMessage(messages.noRepeatFilm)}
            </p>
            {w.topMovie?.ratingKey && (
              <div className="flex gap-2">
                <img
                  src={`/imageproxy/plex/${w.topMovie.ratingKey}`}
                  alt={w.topMovie.title}
                  className="h-[108px] w-[72px] rounded-[5px] object-cover shadow-[0_12px_24px_-12px_#000]"
                />
              </div>
            )}
          </div>
          <Foot>
            {intl.formatMessage(messages.filmsNote, {
              plays: w.moviePlays,
              episodes: w.episodePlays,
            })}
          </Foot>
        </Card>

        {/* 09 — personality */}
        <Card
          className="bg-[linear-gradient(155deg,#FFB020_0%,#E07A16_100%)] text-[#170D02]"
          glow={false}
        >
          <Eyebrow
            left={`09 — ${intl.formatMessage(messages.yourType)}`}
            right={String(w.year)}
            dark
          />
          <div className="relative z-10 mt-auto">
            <p className="text-[15px] text-[rgba(23,13,2,0.62)]">
              {intl.formatMessage(messages.basedOn)}
            </p>
            <h2 className="mt-2 text-[50px] font-extrabold leading-[0.95] tracking-[-0.04em]">
              {w.personality.name}
            </h2>
            <p className="mt-4 max-w-[30ch] text-[15px] leading-relaxed text-[rgba(23,13,2,0.62)]">
              {w.personality.line}
            </p>
          </div>
          <Foot dark>{intl.formatMessage(messages.shareNote)}</Foot>
        </Card>

        {/* 10 — finale */}
        <Card>
          <Eyebrow
            left={intl.formatMessage(messages.title)}
            right={String(w.year)}
          />
          <div className="relative z-10 mt-auto">
            <p className={`text-[15px] ${MUTED}`}>
              {intl.formatMessage(messages.fourNumbers, {
                name: user?.displayName ?? '',
              })}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-[rgba(245,239,230,0.12)]">
              {[
                { label: messages.hours, value: w.hours },
                { label: messages.plays, value: w.plays },
                { label: messages.daysActive, value: w.daysActive },
                {
                  label: messages.bestStreak,
                  value: w.longestStreak?.days ?? 0,
                },
              ].map((item) => (
                <div key={item.label.id} className="bg-[#0A0908] px-3 py-3.5">
                  <div className="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-[rgba(245,239,230,0.4)]">
                    {intl.formatMessage(item.label)}
                  </div>
                  <div className="text-[26px] font-extrabold tabular-nums">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
            {w.firstPlay && (
              <p className={`mt-5 text-[15px] leading-relaxed ${MUTED}`}>
                {intl.formatMessage(messages.firstPlay, {
                  title: w.firstPlay.title,
                  date: day(w.firstPlay.date),
                })}
              </p>
            )}
          </div>
          <Foot>{intl.formatMessage(messages.finale)}</Foot>
        </Card>
      </div>
    </div>
  );
};

export default Wrapped;
