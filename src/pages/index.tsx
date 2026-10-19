import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Bell, Check, Clock3, Pause, Play, RotateCcw, Settings2, Volume2 } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface TimerSettings {
  roundSeconds: number;
  firstAlertSeconds: number;
  secondAlertSeconds: number;
}

interface SettingsForm {
  roundMinutes: string;
  roundExtraSeconds: string;
  firstMinutes: string;
  firstSeconds: string;
  secondMinutes: string;
  secondSeconds: string;
}

const STORAGE_KEY = 'round-timer-settings';
const SOUND_STORAGE_KEY = 'round-timer-sound';
// const SOUND_OPTIONS = [
//   { id: 'built-in', label: '內建三聲鈴' },
//   { id: 'sound-3', label: 'default', url: 'https://cclcltd.sharepoint.com/sites/Cindys/Shared%20Documents/Ring/y1164.mp3?download=1' },
//   { id: 'sound-1', label: '01', url: 'https://cclcltd.sharepoint.com/sites/Cindys/Shared%20Documents/Ring/13196.mp3?download=1' },
//   { id: 'sound-2', label: '02', url: 'https://cclcltd.sharepoint.com/sites/Cindys/Shared%20Documents/Ring/xm2407.mp3?download=1' },  
//   { id: 'sound-4', label: '03', url: 'https://cclcltd.sharepoint.com/sites/Cindys/Shared%20Documents/Ring/y1319.wav?download=1' },
// ] as const;
const SOUND_OPTIONS = [
  { id: 'built-in', label: '內建三聲鈴' },
  { id: 'sound-1', label: '鈴聲-1 (default)', url: 'apps/round-timer/public/files/ring/13196.mp3' },
  { id: 'sound-2', label: '鈴聲-2', url: 'apps/round-timer/public/files/ring/xm2407.mp3' },
  { id: 'sound-3', label: '鈴聲-3', url: 'apps/round-timer/public/files/ring/y1164.mp3' },
  { id: 'sound-4', label: '鈴聲-4', url: 'apps/round-timer/public/files/ring/y1319.wav' },
] as const;
type SoundId = typeof SOUND_OPTIONS[number]['id'];
const DEFAULT_SETTINGS: TimerSettings = {
  roundSeconds: 300,
  firstAlertSeconds: 60,
  secondAlertSeconds: 30,
};

const formatTime = (totalSeconds: number) => {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const settingsToForm = (settings: TimerSettings): SettingsForm => ({
  roundMinutes: String(Math.floor(settings.roundSeconds / 60)),
  roundExtraSeconds: String(settings.roundSeconds % 60),
  firstMinutes: String(Math.floor(settings.firstAlertSeconds / 60)),
  firstSeconds: String(settings.firstAlertSeconds % 60),
  secondMinutes: String(Math.floor(settings.secondAlertSeconds / 60)),
  secondSeconds: String(settings.secondAlertSeconds % 60),
});

const playChime = (audioContext: AudioContext): void => {
  const startAt = audioContext.currentTime + 0.04;
  const masterGain = audioContext.createGain();
  masterGain.gain.setValueAtTime(0.0001, startAt);
  masterGain.gain.exponentialRampToValueAtTime(0.9, startAt + 0.02);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 1.05);
  masterGain.connect(audioContext.destination);

  [0, 0.3, 0.6].forEach((delay: number, index: number) => {
    const oscillator = audioContext.createOscillator();
    const noteGain = audioContext.createGain();
    const noteStart = startAt + delay;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(index === 2 ? 1046.5 : 783.99, noteStart);
    noteGain.gain.setValueAtTime(0.0001, noteStart);
    noteGain.gain.exponentialRampToValueAtTime(1, noteStart + 0.015);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.24);
    oscillator.connect(noteGain);
    noteGain.connect(masterGain);
    oscillator.start(noteStart);
    oscillator.stop(noteStart + 0.26);
  });
};

const readSettings = (): TimerSettings => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(saved) as Partial<TimerSettings>;
    if (
      typeof parsed.roundSeconds === 'number' &&
      typeof parsed.firstAlertSeconds === 'number' &&
      typeof parsed.secondAlertSeconds === 'number' &&
      parsed.roundSeconds > parsed.firstAlertSeconds &&
      parsed.firstAlertSeconds > parsed.secondAlertSeconds &&
      parsed.secondAlertSeconds > 0
    ) {
      return parsed as TimerSettings;
    }
  } catch {
    return DEFAULT_SETTINGS;
  }
  return DEFAULT_SETTINGS;
};

export default function HomePage() {
  const [settings, setSettings] = useState<TimerSettings>(readSettings);
  const [form, setForm] = useState<SettingsForm>(() => settingsToForm(readSettings()));
  const [remaining, setRemaining] = useState<number>(() => readSettings().roundSeconds);
  const [status, setStatus] = useState<'idle' | 'running' | 'paused' | 'finished'>('idle');
  const [firedAlerts, setFiredAlerts] = useState<Set<number>>(new Set());
  const [pulse, setPulse] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [selectedSound, setSelectedSound] = useState<SoundId>(() => {
    const saved = window.localStorage.getItem(SOUND_STORAGE_KEY);
    return SOUND_OPTIONS.some((sound: typeof SOUND_OPTIONS[number]) => sound.id === saved) ? saved as SoundId : 'built-in';
  });
  const endAtRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const customAudioRef = useRef<HTMLAudioElement | null>(null);

  const getAudioContext = useCallback((): AudioContext => {
    if (!audioContextRef.current) {
      const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextConstructor) throw new Error('AudioContext is not supported');
      audioContextRef.current = new AudioContextConstructor();
    }
    return audioContextRef.current;
  }, []);

  const unlockAudio = useCallback(async (): Promise<boolean> => {
    try {
      if (selectedSound === 'built-in') {
        const audioContext = getAudioContext();
        if (audioContext.state === 'suspended') await audioContext.resume();
        setAudioReady(audioContext.state === 'running');
        return audioContext.state === 'running';
      }
      const selected = SOUND_OPTIONS.find((sound: typeof SOUND_OPTIONS[number]) => sound.id === selectedSound);
      if (!selected || !('url' in selected)) return false;
      const audio = new Audio(selected.url);
      audio.preload = 'auto';
      customAudioRef.current = audio;
      setAudioReady(true);
      return true;
    } catch (error: unknown) {
      setAudioReady(false);
      toast.error('無法啟用音訊，請確認 SharePoint 存取權與瀏覽器音效設定');
      return false;
    }
  }, [getAudioContext, selectedSound]);

  const playBell = useCallback(async (manual = false): Promise<void> => {
    try {
      if (selectedSound === 'built-in') {
        const audioContext = getAudioContext();
        if (audioContext.state === 'suspended') await audioContext.resume();
        if (audioContext.state !== 'running') throw new Error('AudioContext is not running');
        playChime(audioContext);
      } else {
        const selected = SOUND_OPTIONS.find((sound: typeof SOUND_OPTIONS[number]) => sound.id === selectedSound);
        if (!selected || !('url' in selected)) throw new Error('Sound is unavailable');
        const audio = customAudioRef.current ?? new Audio(selected.url);
        customAudioRef.current = audio;
        audio.pause();
        audio.currentTime = 0;
        await audio.play();
      }
      setAudioReady(true);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 1100);
      if (manual) toast.success('正在播放測試鈴聲');
    } catch (error: unknown) {
      setAudioReady(false);
      toast.error('無法播放這個鈴聲，請確認已登入 SharePoint，或改用內建鈴聲');
    }
  }, [getAudioContext, selectedSound]);

  const changeSound = (value: string): void => {
    const sound = SOUND_OPTIONS.find((option: typeof SOUND_OPTIONS[number]) => option.id === value);
    if (!sound) return;
    customAudioRef.current?.pause();
    customAudioRef.current = null;
    setSelectedSound(sound.id);
    setAudioReady(false);
    window.localStorage.setItem(SOUND_STORAGE_KEY, sound.id);
  };

  useEffect(() => {
    if (status !== 'running') return;
    const intervalId = window.setInterval(() => {
      if (endAtRef.current === null) return;
      const next = Math.max(0, (endAtRef.current - Date.now()) / 1000);
      setRemaining(next);
      if (next <= 0) {
        setStatus('finished');
        endAtRef.current = null;
      }
    }, 100);
    return () => window.clearInterval(intervalId);
  }, [status]);

  useEffect(() => {
    const checkpoints = [settings.firstAlertSeconds, settings.secondAlertSeconds, 0];
    checkpoints.forEach((checkpoint: number) => {
      if (remaining <= checkpoint && !firedAlerts.has(checkpoint) && (status === 'running' || status === 'finished')) {
        setFiredAlerts((previous: Set<number>) => new Set(previous).add(checkpoint));
        void playBell();
        toast.info(checkpoint === 0 ? '本回合時間到' : `剩餘 ${formatTime(checkpoint)}`);
      }
    });
  }, [firedAlerts, playBell, remaining, settings, status]);

  const progress = useMemo(
    () => Math.max(0, Math.min(100, ((settings.roundSeconds - remaining) / settings.roundSeconds) * 100)),
    [remaining, settings.roundSeconds],
  );

  const nextAlert = useMemo(() => {
    if (status === 'finished') return '回合已完成';
    if (remaining > settings.firstAlertSeconds) return `下次提示 ${formatTime(settings.firstAlertSeconds)}`;
    if (remaining > settings.secondAlertSeconds) return `下次提示 ${formatTime(settings.secondAlertSeconds)}`;
    return '下次提示 回合結束';
  }, [remaining, settings, status]);

  const startOrResume = async (): Promise<void> => {
    const unlocked = audioReady || await unlockAudio();
    if (!unlocked) return;
    endAtRef.current = Date.now() + remaining * 1000;
    setStatus('running');
  };

  const pause = () => {
    setStatus('paused');
    endAtRef.current = null;
  };

  const reset = () => {
    setRemaining(settings.roundSeconds);
    setStatus('idle');
    setFiredAlerts(new Set());
    endAtRef.current = null;
  };

  const updateField = (field: keyof SettingsForm) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((previous: SettingsForm) => ({ ...previous, [field]: event.target.value }));
  };

  const applySettings = () => {
    const values = Object.values(form).map((value: string) => Number(value));
    if (values.some((value: number) => !Number.isInteger(value) || value < 0)) {
      toast.error('請輸入有效的非負整數');
      return;
    }
    const roundSeconds = Number(form.roundMinutes) * 60 + Number(form.roundExtraSeconds);
    const firstAlertSeconds = Number(form.firstMinutes) * 60 + Number(form.firstSeconds);
    const secondAlertSeconds = Number(form.secondMinutes) * 60 + Number(form.secondSeconds);
    if (roundSeconds <= 0 || roundSeconds > 24 * 60 * 60) {
      toast.error('回合時間需介於 1 秒到 24 小時');
      return;
    }
    if (!(roundSeconds > firstAlertSeconds && firstAlertSeconds > secondAlertSeconds && secondAlertSeconds > 0)) {
      toast.error('提示時間必須依序小於回合時間，且第二次提示需大於 0 秒');
      return;
    }
    const nextSettings = { roundSeconds, firstAlertSeconds, secondAlertSeconds };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
    setSettings(nextSettings);
    setRemaining(roundSeconds);
    setStatus('idle');
    setFiredAlerts(new Set());
    endAtRef.current = null;
    toast.success('設定已儲存並套用');
  };

  const checkpoints = [
    { label: '第一次提示', time: settings.firstAlertSeconds },
    { label: '第二次提示', time: settings.secondAlertSeconds },
    { label: '回合結束', time: 0 },
  ];

  return (
    <main className="relative flex flex-1 items-center overflow-hidden px-4 py-8 sm:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--color-secondary),transparent_42%)]" />
      <div className="relative mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.45fr_0.75fr]">
        <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: 'easeOut' as const }}>
          <Card className="overflow-hidden border-2 shadow-xl">
            <CardHeader className="flex flex-row items-start justify-between gap-4 border-b bg-card text-card-foreground">
              <div>
                <Badge variant="secondary" className="mb-3"><Clock3 /> 專注回合</Badge>
                <CardTitle className="text-2xl">計時小幫手</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">精準掌握每一次提醒，不錯過回合節奏。</p>
              </div>
              <motion.div animate={pulse ? { rotate: [-8, 8, -8, 0], scale: [1, 1.12, 1] } : { rotate: 0, scale: 1 }}>
                <Button type="button" size="icon-lg" variant="secondary" onClick={() => void playBell(true)} aria-label="啟用音訊並測試鈴聲">
                  <Bell className="size-5" />
                </Button>
              </motion.div>
            </CardHeader>
            <CardContent className="space-y-8 p-6 sm:p-10">
              <div className="text-center">
                <p className="mb-2 text-sm font-medium text-muted-foreground">{status === 'running' ? '倒數進行中' : status === 'paused' ? '已暫停' : status === 'finished' ? '時間到' : '準備開始'}</p>
                <div className="font-mono text-6xl font-black tracking-tight tabular-nums sm:text-8xl" aria-live="polite">{formatTime(remaining)}</div>
                <p className="mt-3 text-sm text-muted-foreground">{nextAlert}</p>
              </div>
              <div className="space-y-3">
                <Progress value={progress} className="h-3" />
                <div className="flex justify-between text-xs text-muted-foreground"><span>已進行 {Math.round(progress)}%</span><span>每回合 {formatTime(settings.roundSeconds)}</span></div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {checkpoints.map((checkpoint: { label: string; time: number }) => {
                  const completed = firedAlerts.has(checkpoint.time);
                  return (
                    <div key={checkpoint.label} className={completed ? 'rounded-xl border bg-primary p-3 text-center text-primary-foreground' : 'rounded-xl border bg-muted p-3 text-center text-muted-foreground'}>
                      <div className="mb-1 flex items-center justify-center gap-1 text-xs font-semibold">{completed && <Check className="size-3" />}{checkpoint.label}</div>
                      <div className="font-mono text-lg font-bold tabular-nums">{formatTime(checkpoint.time)}</div>
                    </div>
                  );
                })}
              </div>
              <div className={audioReady ? 'rounded-xl border-l-4 border-l-primary bg-card p-4 text-sm text-card-foreground' : 'rounded-xl bg-muted p-4 text-sm text-muted-foreground'}>
                {audioReady ? '音訊已啟用，倒數提示會自動播放。' : '請先按「啟用音訊」測試鈴聲；若仍無聲，請檢查瀏覽器分頁與裝置是否靜音。'}
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                {status === 'running' ? (
                  <Button type="button" size="lg" onClick={pause}><Pause /> 暫停</Button>
                ) : (
                  <Button type="button" size="lg" onClick={() => void (status === 'finished' ? Promise.resolve(reset()) : startOrResume())}><Play /> {status === 'paused' ? '繼續' : status === 'finished' ? '再來一回合' : '開始'}</Button>
                )}
                <Button type="button" size="lg" variant="outline" onClick={reset}><RotateCcw /> 重新開始</Button>
                <Button type="button" size="lg" variant="secondary" onClick={() => void playBell(true)}><Volume2 /> {audioReady ? '測試鈴聲' : '啟用音訊'}</Button>
              </div>
            </CardContent>
          </Card>
        </motion.section>

        <motion.aside initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.45, delay: 0.08, ease: 'easeOut' as const }}>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-xl"><Settings2 className="size-5" />時間設定</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <TimeFields label="每回合時間" minutes={form.roundMinutes} seconds={form.roundExtraSeconds} onMinutes={updateField('roundMinutes')} onSeconds={updateField('roundExtraSeconds')} />
              <Separator />
              <TimeFields label="第一次提示（剩餘）" minutes={form.firstMinutes} seconds={form.firstSeconds} onMinutes={updateField('firstMinutes')} onSeconds={updateField('firstSeconds')} />
              <TimeFields label="第二次提示（剩餘）" minutes={form.secondMinutes} seconds={form.secondSeconds} onMinutes={updateField('secondMinutes')} onSeconds={updateField('secondSeconds')} />
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="alert-sound">提示鈴聲</Label>
                <div className="flex gap-2">
                  <Select value={selectedSound} onValueChange={changeSound}>
                    <SelectTrigger id="alert-sound" className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SOUND_OPTIONS.filter((sound: typeof SOUND_OPTIONS[number]) => sound.id).map((sound: typeof SOUND_OPTIONS[number]) => (
                        <SelectItem key={sound.id} value={sound.id}>{sound.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="icon" onClick={() => void playBell(true)} aria-label="試聽目前鈴聲"><Volume2 /></Button>
                </div>
                <p className="text-xs text-muted-foreground">選擇後立即儲存在這台裝置；自訂鈴聲需能存取 SharePoint。</p>
              </div>
              <div className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">第三次提示固定在回合結束時。設定會儲存在這台裝置中。</div>
              {status === 'running' && <div className="rounded-xl border-l-4 border-l-primary bg-card p-4 text-sm text-card-foreground">套用新設定會停止目前倒數並重新準備。</div>}
              <Button type="button" className="w-full" onClick={applySettings}>套用設定</Button>
            </CardContent>
          </Card>
        </motion.aside>
      </div>
    </main>
  );
}

interface TimeFieldsProps {
  label: string;
  minutes: string;
  seconds: string;
  onMinutes: (event: ChangeEvent<HTMLInputElement>) => void;
  onSeconds: (event: ChangeEvent<HTMLInputElement>) => void;
}

function TimeFields({ label, minutes, seconds, onMinutes, onSeconds }: TimeFieldsProps) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{label}</legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1"><Label>分鐘</Label><Input type="number" min="0" max="1440" inputMode="numeric" value={minutes} onChange={onMinutes} /></div>
        <div className="space-y-1"><Label>秒數</Label><Input type="number" min="0" max="59" inputMode="numeric" value={seconds} onChange={onSeconds} /></div>
      </div>
    </fieldset>
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
