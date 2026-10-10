// Background music through the official YouTube IFrame Player API.
// The video is streamed by YouTube in an embedded player (no download), so it must stay visible (>= 200x200 policy).
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export class YouTubeMusic {
  private player: any = null;
  private ready = false;
  private wantPlay = false;
  playing = false;
  onState?: (text: string) => void;

  constructor(private elementId: string, private videoId: string, private volume = 35) {}

  // Load the API script once; the player is created when it is ready
  load() {
    if (this.player || document.getElementById('yt-iframe-api')) return;
    const s = document.createElement('script');
    s.id = 'yt-iframe-api';
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => this.onState?.('無法載入 YouTube (offline?)');
    document.head.appendChild(s);
    window.onYouTubeIframeAPIReady = () => {
      this.player = new window.YT.Player(this.elementId, {
        width: 200,
        height: 200,
        videoId: this.videoId,
        playerVars: { autoplay: 0, controls: 1, loop: 1, playlist: this.videoId, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            this.ready = true;
            this.player.setVolume(this.volume);
            if (this.wantPlay) this.player.playVideo();
          },
          onStateChange: (e: any) => {
            this.playing = e.data === window.YT.PlayerState.PLAYING;
            this.onState?.(this.playing ? '播放中 Playing' : '已暫停 Paused');
          },
          // 101 / 150: the owner does not allow embedding
          onError: (e: any) => this.onState?.(e.data === 101 || e.data === 150 ? '此影片不允許嵌入播放' : `播放錯誤 ${e.data}`),
        },
      });
    };
  }

  toggle() {
    this.load();
    if (!this.ready) {
      this.wantPlay = !this.wantPlay; // play as soon as the player is ready
      this.onState?.(this.wantPlay ? '載入中 Loading…' : '已暫停 Paused');
      return;
    }
    if (this.playing) this.player.pauseVideo();
    else this.player.playVideo();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ready) this.player.setVolume(v);
  }
}
