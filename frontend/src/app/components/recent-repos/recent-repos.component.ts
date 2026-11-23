import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RecentRepo } from '../../services/recent-repos.service';

export interface RepoSelectRequest {
  url: string;
  branch: string;
  isRecent: boolean;
}

interface StarterRepo {
  url: string;
  owner: string;
  repoName: string;
  fullName: string;
  branch: string;
  description: string;
  language: string;
}

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#eab308',
  Python: '#22c55e',
  Go: '#06b6d4',
  Rust: '#f97316',
  Java: '#ef4444',
  Kotlin: '#a78bfa',
  Swift: '#f97316',
  Dart: '#06b6d4',
  HTML: '#f97316',
  CSS: '#ec4899',
  SCSS: '#ec4899',
  Ruby: '#ef4444',
  PHP: '#a78bfa',
  'C#': '#22c55e',
  'C++': '#3b82f6',
  C: '#3b82f6',
  Shell: '#22c55e',
  Vue: '#22c55e',
  Svelte: '#f97316'
};

@Component({
  selector: 'app-recent-repos',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="mb-4 flex-shrink-0 animate-fade-in">

      <!-- Section header -->
      <div class="flex items-center justify-between gap-2 mb-2.5 px-0.5">
        <div class="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--muted)">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span class="text-label">Recent repositories</span>
          <span *ngIf="recentRepos.length > 0" class="badge">{{ recentRepos.length }}</span>
        </div>

        <button
          *ngIf="recentRepos.length > 0"
          type="button"
          (click)="onClearAll()"
          class="btn-ghost text-[11px] py-0.5 px-2 cg-hover-error"
          style="color: var(--muted);"
          title="Clear recent repositories">
          Clear
        </button>
      </div>

      <!-- Recent repository cards -->
      <div *ngIf="recentRepos.length > 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        <div
          *ngFor="let repo of recentRepos; trackBy: trackByRecent"
          class="cg-recent-card group relative rounded-xl transition-all"
          [class.is-loading]="isCardLoading(repo.url)"
          [class.opacity-60]="loading && !isCardLoading(repo.url)">

          <button
            type="button"
            (click)="onSelectRecent(repo)"
            [disabled]="isCardLoading(repo.url)"
            class="cg-recent-card-btn w-full h-full text-left p-3.5 pr-10 rounded-xl flex flex-col justify-between gap-2.5">

            <!-- Repo identity + description -->
            <div class="min-w-0">
              <div class="flex items-center gap-2 min-w-0">
                <svg *ngIf="repo.private" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0" style="color: var(--warning)">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <svg *ngIf="!repo.private" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0" style="color: var(--accent)">
                  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
                </svg>

                <span class="text-[13px] truncate min-w-0" style="font-family: 'JetBrains Mono', monospace;">
                  <span style="color: var(--muted)">{{ repo.owner }}/</span><span class="font-semibold" style="color: var(--text)">{{ repo.repoName }}</span>
                </span>

                <span *ngIf="repo.private"
                      class="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                      style="background: var(--warning-dim); color: var(--warning); border: 1px solid var(--warning-border);">
                  PRIVATE
                </span>
              </div>

              <p *ngIf="repo.description"
                 class="text-[11.5px] truncate mt-1.5"
                 style="color: var(--text-secondary)"
                 [title]="repo.description">
                {{ repo.description }}
              </p>
            </div>

            <!-- Metadata row -->
            <div class="flex items-center gap-2 text-[11px] flex-wrap" style="color: var(--muted)">
              <span *ngIf="repo.branch"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded max-w-[120px]"
                    style="background: var(--card); border: 1px solid var(--border-subtle); font-family: 'JetBrains Mono', monospace; color: var(--text-secondary);">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0">
                  <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
                </svg>
                <span class="truncate">{{ repo.branch }}</span>
              </span>

              <span *ngIf="repo.language" class="inline-flex items-center gap-1 flex-shrink-0">
                <span class="w-2 h-2 rounded-full flex-shrink-0" [style.background-color]="getLanguageColor(repo.language)"></span>
                {{ repo.language }}
              </span>

              <span *ngIf="repo.totalFiles > 0" class="flex-shrink-0">
                {{ repo.totalFiles }} {{ repo.totalFiles === 1 ? 'file' : 'files' }}
              </span>

              <span *ngIf="isCardLoading(repo.url)" class="ml-auto font-medium flex-shrink-0" style="color: var(--accent)">
                Analyzing…
              </span>
              <span *ngIf="!isCardLoading(repo.url)" class="ml-auto flex-shrink-0">
                {{ formatRelativeTime(repo.lastAnalyzedAt) }}
              </span>
            </div>
          </button>

          <!-- Loading spinner when analyzing this card -->
          <div *ngIf="isCardLoading(repo.url)" class="absolute top-3.5 right-3.5 pointer-events-none">
            <div class="spinner" style="width: 14px; height: 14px; border-width: 1.75px;"></div>
          </div>

          <!-- Remove button -->
          <button
            *ngIf="!isCardLoading(repo.url)"
            type="button"
            (click)="onRemoveRecent(repo, $event)"
            class="cg-recent-remove absolute top-2.5 right-2.5 w-6 h-6 rounded-md flex items-center justify-center opacity-70 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus:opacity-100"
            title="Remove from recent"
            [attr.aria-label]="'Remove ' + repo.fullName + ' from recent repositories'">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Empty state with one-click starter repositories -->
      <div *ngIf="recentRepos.length === 0" class="card p-3.5 sm:p-4">
        <p class="text-xs mb-3" style="color: var(--muted)">
          Repositories you analyze appear here for one-click access. Try one below to get started:
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            *ngFor="let starter of starterRepos; trackBy: trackByStarter"
            type="button"
            (click)="onSelectStarter(starter)"
            [disabled]="isCardLoading(starter.url)"
            class="cg-quick-chip text-left p-3 rounded-xl flex flex-col justify-between gap-2"
            [class.is-loading]="isCardLoading(starter.url)"
            [class.opacity-60]="loading && !isCardLoading(starter.url)">

            <div class="flex items-center justify-between gap-2 min-w-0">
              <span class="text-xs truncate min-w-0" style="font-family: 'JetBrains Mono', monospace;">
                <span style="color: var(--muted)">{{ starter.owner }}/</span><span class="font-semibold" style="color: var(--text)">{{ starter.repoName }}</span>
              </span>

              <div *ngIf="isCardLoading(starter.url)" class="spinner flex-shrink-0" style="width: 12px; height: 12px; border-width: 1.5px;"></div>
              <svg *ngIf="!isCardLoading(starter.url)" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="flex-shrink-0 opacity-70" style="color: var(--accent)">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>

            <p class="text-[11px] truncate" style="color: var(--text-secondary)">
              {{ starter.description }}
            </p>

            <div class="flex items-center gap-2 text-[10.5px]" style="color: var(--muted)">
              <span class="inline-flex items-center gap-1" style="font-family: 'JetBrains Mono', monospace;">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
                </svg>
                {{ starter.branch }}
              </span>
              <span>·</span>
              <span class="inline-flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full" [style.background-color]="getLanguageColor(starter.language)"></span>
                {{ starter.language }}
              </span>
            </div>
          </button>
        </div>
      </div>
    </section>
  `
})
export class RecentReposComponent {
  @Input() recentRepos: RecentRepo[] = [];
  @Input() loading = false;
  @Input() activeRepoUrl = '';

  @Output() selectRepo = new EventEmitter<RepoSelectRequest>();
  @Output() removeRepo = new EventEmitter<RecentRepo>();
  @Output() clearAll = new EventEmitter<void>();

  readonly starterRepos: StarterRepo[] = [
    {
      url: 'https://github.com/XeCipher/CopyGit',
      owner: 'XeCipher',
      repoName: 'CopyGit',
      fullName: 'XeCipher/CopyGit',
      branch: 'main',
      description: 'Bundle GitHub codebases for any AI in seconds',
      language: 'TypeScript'
    },
    {
      url: 'https://github.com/chalk/chalk',
      owner: 'chalk',
      repoName: 'chalk',
      fullName: 'chalk/chalk',
      branch: 'main',
      description: 'Terminal string styling done right',
      language: 'JavaScript'
    },
    {
      url: 'https://github.com/sindresorhus/ky',
      owner: 'sindresorhus',
      repoName: 'ky',
      fullName: 'sindresorhus/ky',
      branch: 'main',
      description: 'Tiny & elegant HTTP client based on Fetch',
      language: 'TypeScript'
    }
  ];

  onSelectRecent(repo: RecentRepo) {
    this.selectRepo.emit({
      url: repo.url,
      branch: repo.branch,
      isRecent: true
    });
  }

  onSelectStarter(starter: StarterRepo) {
    this.selectRepo.emit({
      url: starter.url,
      branch: starter.branch,
      isRecent: false
    });
  }

  onRemoveRecent(repo: RecentRepo, event: Event) {
    event.stopPropagation();
    this.removeRepo.emit(repo);
  }

  onClearAll() {
    this.clearAll.emit();
  }

  isCardLoading(url: string): boolean {
    return this.loading && Boolean(this.activeRepoUrl) && this.activeRepoUrl.toLowerCase() === url.toLowerCase();
  }

  getLanguageColor(language: string): string {
    return LANGUAGE_COLORS[language] || 'var(--accent)';
  }

  formatRelativeTime(timestamp: number): string {
    if (!timestamp) return '';
    const diffMs = Math.max(0, Date.now() - timestamp);
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    const date = new Date(timestamp);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString(undefined, sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' }
    );
  }

  trackByRecent(_index: number, item: RecentRepo): string {
    return item.fullName;
  }

  trackByStarter(_index: number, item: StarterRepo): string {
    return item.fullName;
  }
}