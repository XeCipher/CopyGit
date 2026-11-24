import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  HostListener,
  ElementRef,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CommitInfo } from '../../services/api.service';

export interface CommitSelectionEvent {
  sha: string;
  commit: CommitInfo | null;
}

interface HighlightParts {
  before: string;
  match: string;
  after: string;
}

@Component({
  selector: 'app-commit-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="relative w-full">

      <!-- Trigger button -->
      <button
        type="button"
        (click)="toggle()"
        [disabled]="disabled"
        [attr.aria-expanded]="isOpen"
        aria-haspopup="listbox"
        [title]="triggerTooltip"
        class="cg-selector-trigger"
        [class.is-open]="isOpen"
        [class.is-disabled]="disabled">

        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"
             class="flex-shrink-0"
             [style.color]="selectedCommitSha ? 'var(--accent)' : 'var(--muted)'">
          <circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/>
        </svg>

        <div class="flex-1 text-left truncate min-w-0 flex items-center gap-1.5">
          <ng-container *ngIf="!selectedCommitSha">
            <span class="text-[13px] font-medium" style="color: var(--text)">Latest</span>
            <span *ngIf="headCommit && !headCommit.empty && headCommit.sha"
                  class="text-[11.5px] truncate hidden sm:inline"
                  style="font-family: 'JetBrains Mono', monospace; color: var(--muted);">
              · {{ headCommit.sha | slice:0:7 }}
            </span>
          </ng-container>

          <ng-container *ngIf="selectedCommitSha">
            <span class="text-[13px] font-semibold truncate"
                  style="font-family: 'JetBrains Mono', monospace; color: var(--accent);">
              {{ selectedCommitSha | slice:0:7 }}
            </span>
          </ng-container>
        </div>

        <div *ngIf="loading && !isOpen" class="spinner flex-shrink-0" style="width: 14px; height: 14px;"></div>
        <svg *ngIf="!loading || isOpen" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
             class="flex-shrink-0 transition-transform duration-150"
             [style.transform]="isOpen ? 'rotate(180deg)' : 'rotate(0deg)'"
             style="color: var(--muted)">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      <!-- Mobile backdrop -->
      <div *ngIf="isOpen"
           class="fixed inset-0 z-40 sm:hidden modal-backdrop"
           style="background: var(--modal-backdrop);"
           (click)="close()">
      </div>

      <!-- Dropdown panel: bottom sheet on mobile, right-aligned popover on sm+ -->
      <div *ngIf="isOpen"
           role="listbox"
           aria-label="Commits"
           class="cg-dropdown-panel fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl sm:absolute sm:bottom-auto sm:left-auto sm:right-0 sm:top-[calc(100%+6px)] sm:w-[390px] sm:rounded-xl flex flex-col max-h-[80dvh] sm:max-h-[min(420px,calc(100dvh_-_13rem))] overflow-hidden">

        <!-- Mobile sheet handle + title -->
        <div class="sm:hidden flex flex-col items-center pt-2 pb-1.5 px-4 flex-shrink-0"
             style="border-bottom: 1px solid var(--border-subtle);">
          <div class="w-9 h-1 rounded-full mb-2.5" style="background: var(--border);"></div>
          <div class="w-full flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-sm font-semibold flex-shrink-0" style="color: var(--text)">Select Commit</span>
              <span *ngIf="branchName"
                    class="badge truncate max-w-[140px]"
                    style="font-family: 'JetBrains Mono', monospace;">
                {{ branchName }}
              </span>
            </div>
            <button type="button"
                    (click)="close()"
                    class="w-7 h-7 rounded-lg flex items-center justify-center cg-hover-card flex-shrink-0"
                    style="color: var(--muted);"
                    aria-label="Close commit selector">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Search & SHA lookup bar -->
        <div class="p-2 flex-shrink-0" style="border-bottom: 1px solid var(--border-subtle);">
          <div class="relative">
            <div class="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style="color: var(--muted)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <input
              #searchInput
              type="text"
              [(ngModel)]="searchQuery"
              (ngModelChange)="onSearchChange()"
              (keydown)="onSearchKeydown($event)"
              placeholder="Filter commits or paste SHA…"
              class="cg-input text-xs"
              style="padding-left: 1.9rem; padding-right: 1.9rem; padding-top: 0.45rem; padding-bottom: 0.45rem; font-family: 'JetBrains Mono', monospace;"
              spellcheck="false"
              autocomplete="off"
            />
            <button
              *ngIf="searchQuery"
              type="button"
              (click)="clearSearch()"
              class="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center cg-hover-elevated"
              style="color: var(--muted);"
              aria-label="Clear commit search">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <p *ngIf="lookupError" class="mt-1.5 px-1 text-[11px]" style="color: var(--error)">
            {{ lookupError }}
          </p>
        </div>

        <!-- Scrollable commit list -->
        <div #listContainer class="flex-1 overflow-y-auto p-1.5 space-y-1 min-h-0">

          <!-- Latest (HEAD) option -->
          <button
            *ngIf="showLatestOption"
            type="button"
            role="option"
            [attr.aria-selected]="!selectedCommitSha"
            (click)="selectLatest()"
            class="cg-dropdown-item w-full text-left px-2.5 py-2 rounded-lg flex items-start gap-2.5 min-w-0"
            [class.is-selected]="!selectedCommitSha">

            <div class="mt-0.5 flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
                   [style.color]="!selectedCommitSha ? 'var(--accent)' : 'var(--muted)'">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-semibold" [style.color]="!selectedCommitSha ? 'var(--accent)' : 'var(--text)'">
                  Latest (HEAD)
                </span>
                <span *ngIf="headCommit && !headCommit.empty"
                      class="text-[10px] px-1.5 py-0.5 rounded font-mono"
                      style="background: var(--accent-dim); color: var(--accent);">
                  {{ headCommit.sha | slice:0:7 }}
                </span>
              </div>
              <p *ngIf="headCommit && !headCommit.empty"
                 class="text-[11px] truncate mt-0.5"
                 style="color: var(--text-secondary)">
                {{ headCommit.message }}
              </p>
              <p *ngIf="headCommit && !headCommit.empty && headCommit.date"
                 class="text-[10.5px] mt-0.5"
                 style="color: var(--muted)">
                {{ headCommit.author }} · {{ headCommit.date | date:'MMM d, yyyy, h:mm a' }}
              </p>
            </div>

            <svg *ngIf="!selectedCommitSha" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"
                 class="flex-shrink-0 mt-1" style="color: var(--accent)">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>

          <!-- Pinned commit loaded via direct SHA lookup -->
          <button
            *ngIf="showPinnedOutsideList && pinnedCommitInfo"
            type="button"
            role="option"
            [attr.aria-selected]="true"
            (click)="selectCommit(pinnedCommitInfo)"
            class="cg-dropdown-item is-selected w-full text-left px-2.5 py-2 rounded-lg flex items-start gap-2.5 min-w-0">

            <span class="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                  style="background: var(--accent-dim); color: var(--accent);">
              {{ pinnedCommitInfo.sha | slice:0:7 }}
            </span>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-medium truncate flex-1" style="color: var(--text)">
                  {{ pinnedCommitInfo.message }}
                </span>
                <span class="text-[9.5px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                      style="background: var(--accent-dim); color: var(--accent);">
                  PINNED
                </span>
              </div>
              <p class="text-[10.5px] truncate mt-0.5" style="color: var(--muted)">
                {{ pinnedCommitInfo.author }} · {{ pinnedCommitInfo.date | date:'MMM d, yyyy, h:mm a' }}
              </p>
            </div>

            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"
                 class="flex-shrink-0 mt-1" style="color: var(--accent)">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>

          <!-- Direct GitHub SHA lookup action -->
          <button
            *ngIf="showShaLookupOption"
            type="button"
            (click)="triggerShaLookup()"
            [disabled]="lookingUpSha"
            class="cg-dropdown-item w-full text-left px-2.5 py-2.5 rounded-lg flex items-center gap-2.5 min-w-0"
            style="background: var(--accent-dim); border: 1px solid var(--accent-border);">
            <div *ngIf="lookingUpSha" class="spinner flex-shrink-0" style="width: 13px; height: 13px;"></div>
            <svg *ngIf="!lookingUpSha" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"
                 class="flex-shrink-0" style="color: var(--accent)">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <span class="text-xs truncate flex-1" style="color: var(--text)">
              {{ lookingUpSha ? 'Looking up commit…' : 'Find commit' }}
              <span *ngIf="!lookingUpSha" class="font-mono font-semibold" style="color: var(--accent)">"{{ shaCandidate | slice:0:12 }}"</span>
              <span *ngIf="!lookingUpSha" style="color: var(--muted)"> on GitHub →</span>
            </span>
          </button>

          <!-- Divider -->
          <div *ngIf="filteredCommits.length > 0"
               class="px-2 pt-2 pb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider"
               style="color: var(--muted)">
            <span>Commits on {{ branchName || 'branch' }}</span>
            <span>{{ filteredCommits.length }}{{ hasMore && !trimmedQuery ? '+' : '' }}</span>
          </div>

          <!-- Initial loading state -->
          <div *ngIf="loading && commits.length === 0" class="py-8 flex flex-col items-center justify-center gap-2">
            <div class="spinner"></div>
            <span class="text-xs" style="color: var(--muted)">Loading commits…</span>
          </div>

          <!-- Commit list rows -->
          <button
            *ngFor="let commit of filteredCommits; let i = index; trackBy: trackByCommit"
            type="button"
            role="option"
            [attr.data-commit-idx]="i"
            [attr.aria-selected]="selectedCommitSha === commit.sha"
            (click)="selectCommit(commit)"
            (mouseenter)="highlightedIndex = i"
            class="cg-dropdown-item w-full text-left px-2.5 py-2 rounded-lg flex items-start gap-2.5 min-w-0"
            [class.is-selected]="selectedCommitSha === commit.sha"
            [class.is-highlighted]="i === highlightedIndex && selectedCommitSha !== commit.sha"
            [title]="(commit.date | date:'EEEE, MMM d, yyyy, h:mm:ss a zzzz') || ''">

            <span class="text-[11px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                  [style.background]="selectedCommitSha === commit.sha ? 'var(--accent-dim)' : 'var(--card)'"
                  [style.color]="selectedCommitSha === commit.sha ? 'var(--accent)' : 'var(--text-secondary)'"
                  style="border: 1px solid var(--border-subtle);">
              <ng-container *ngIf="getHighlightParts(commit.sha.slice(0, 7)) as shaParts; else plainSha">
                {{ shaParts.before }}<mark class="cg-mark">{{ shaParts.match }}</mark>{{ shaParts.after }}
              </ng-container>
              <ng-template #plainSha>{{ commit.sha | slice:0:7 }}</ng-template>
            </span>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="text-xs truncate flex-1 min-w-0"
                      [style.font-weight]="selectedCommitSha === commit.sha ? '600' : '500'"
                      [style.color]="selectedCommitSha === commit.sha ? 'var(--accent)' : 'var(--text)'">
                  <ng-container *ngIf="getHighlightParts(commit.message) as msgParts; else plainMsg">
                    {{ msgParts.before }}<mark class="cg-mark">{{ msgParts.match }}</mark>{{ msgParts.after }}
                  </ng-container>
                  <ng-template #plainMsg>{{ commit.message }}</ng-template>
                </span>

                <span *ngIf="headCommit && commit.sha === headCommit.sha"
                      class="text-[9.5px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                      style="background: var(--card); border: 1px solid var(--border); color: var(--muted);">
                  HEAD
                </span>
              </div>

              <div class="text-[11px] truncate mt-0.5" style="color: var(--muted)">
                <ng-container *ngIf="getHighlightParts(commit.author) as authorParts; else plainAuthor">
                  {{ authorParts.before }}<mark class="cg-mark">{{ authorParts.match }}</mark>{{ authorParts.after }}
                </ng-container>
                <ng-template #plainAuthor>{{ commit.author }}</ng-template>
                · {{ commit.date | date:'MMM d, yyyy, h:mm a' }}
              </div>
            </div>

            <svg *ngIf="selectedCommitSha === commit.sha" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"
                 class="flex-shrink-0 mt-1" style="color: var(--accent)">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>

          <!-- Empty state -->
          <div *ngIf="!loading && filteredCommits.length === 0 && !showShaLookupOption && !showLatestOption"
               class="py-8 px-4 text-center text-xs"
               style="color: var(--muted)">
            {{ commits.length === 0 ? 'No commits found on this branch.' : ('No loaded commits match "' + searchQuery + '"') }}
          </div>

          <!-- Pagination button -->
          <div *ngIf="hasMore && !trimmedQuery" class="pt-1 pb-0.5">
            <button
              type="button"
              (click)="onLoadMore($event)"
              [disabled]="loadingMore"
              class="w-full py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-2 cg-hover-card"
              style="color: var(--accent); border: 1px solid var(--border-subtle);">
              <div *ngIf="loadingMore" class="spinner" style="width: 12px; height: 12px;"></div>
              <span>{{ loadingMore ? 'Loading older commits…' : 'Load older commits' }}</span>
            </button>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-3 py-1.5 flex items-center justify-between text-[11px] flex-shrink-0"
             style="border-top: 1px solid var(--border-subtle); background: var(--card); color: var(--muted);">
          <span>{{ selectedCommitSha ? ('Pinned ' + (selectedCommitSha | slice:0:7)) : 'Tracking branch HEAD' }}</span>
          <span class="hidden sm:inline">↑↓ · Enter</span>
        </div>
      </div>
    </div>
  `
})
export class CommitSelectorComponent implements OnChanges {
  @Input() commits: CommitInfo[] = [];
  @Input() selectedCommitSha = '';
  @Input() headCommit: CommitInfo | null = null;
  @Input() pinnedCommitInfo: CommitInfo | null = null;
  @Input() branchName = '';
  @Input() loading = false;
  @Input() loadingMore = false;
  @Input() hasMore = false;
  @Input() lookingUpSha = false;
  @Input() lookupError = '';
  @Input() disabled = false;

  @Output() commitSelected = new EventEmitter<CommitSelectionEvent>();
  @Output() loadMore = new EventEmitter<void>();
  @Output() lookupSha = new EventEmitter<string>();
  @Output() openChange = new EventEmitter<boolean>();

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('listContainer') listContainer?: ElementRef<HTMLDivElement>;

  isOpen = false;
  searchQuery = '';
  filteredCommits: CommitInfo[] = [];
  highlightedIndex = -1;
  shaCandidate = '';

  constructor(private elRef: ElementRef<HTMLElement>) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['commits']) {
      this.updateFiltered();
    }
    if (changes['disabled'] && this.disabled && this.isOpen) {
      this.close();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.isOpen) return;
    if (!this.elRef.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.isOpen) {
      this.close();
    }
  }

  get triggerTooltip(): string {
    if (!this.selectedCommitSha) {
      return this.headCommit?.sha
        ? `Latest commit (${this.headCommit.sha.slice(0, 7)})`
        : 'Latest commit on branch';
    }
    return `Pinned commit ${this.selectedCommitSha.slice(0, 7)}`;
  }

  get trimmedQuery(): string {
    return this.searchQuery.trim();
  }

  get showLatestOption(): boolean {
    const q = this.trimmedQuery.toLowerCase();
    if (!q) return true;
    if ('latest head'.includes(q)) return true;
    if (this.headCommit && !this.headCommit.empty) {
      return (
        this.headCommit.sha.toLowerCase().includes(q) ||
        this.headCommit.message.toLowerCase().includes(q) ||
        this.headCommit.author.toLowerCase().includes(q)
      );
    }
    return false;
  }

  get showPinnedOutsideList(): boolean {
    if (!this.selectedCommitSha || !this.pinnedCommitInfo) return false;
    const existsInFiltered = this.filteredCommits.some(c => c.sha === this.pinnedCommitInfo?.sha);
    if (existsInFiltered) return false;

    const q = this.trimmedQuery.toLowerCase();
    if (!q) return true;
    return (
      this.pinnedCommitInfo.sha.toLowerCase().includes(q) ||
      this.pinnedCommitInfo.message.toLowerCase().includes(q) ||
      this.pinnedCommitInfo.author.toLowerCase().includes(q)
    );
  }

  get showShaLookupOption(): boolean {
    if (!this.shaCandidate) return false;
    const alreadyLoaded = this.commits.some(c => c.sha.toLowerCase().startsWith(this.shaCandidate));
    if (alreadyLoaded) return false;
    return this.shaCandidate.length >= 6 || this.filteredCommits.length === 0;
  }

  toggle() {
    if (this.disabled) return;
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    if (this.disabled || this.isOpen) return;
    this.isOpen = true;
    this.searchQuery = '';
    this.updateFiltered();
    this.highlightedIndex = this.selectedCommitSha
      ? this.filteredCommits.findIndex(c => c.sha === this.selectedCommitSha)
      : -1;
    this.openChange.emit(true);

    setTimeout(() => {
      if (window.innerWidth >= 640) {
        this.searchInput?.nativeElement?.focus();
      }
      this.scrollHighlightedIntoView();
    }, 20);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.searchQuery = '';
    this.shaCandidate = '';
    this.openChange.emit(false);
  }

  onSearchChange() {
    this.shaCandidate = this.extractShaCandidate(this.searchQuery);
    this.updateFiltered();
    this.highlightedIndex = this.filteredCommits.length > 0 ? 0 : -1;
  }

  clearSearch() {
    this.searchQuery = '';
    this.onSearchChange();
    this.searchInput?.nativeElement?.focus();
  }

  selectLatest() {
    const changed = this.selectedCommitSha !== '';
    this.close();
    if (changed) {
      this.commitSelected.emit({ sha: '', commit: this.headCommit });
    }
  }

  selectCommit(commit: CommitInfo) {
    const changed = commit.sha !== this.selectedCommitSha;
    this.close();
    if (changed) {
      this.commitSelected.emit({ sha: commit.sha, commit });
    }
  }

  triggerShaLookup() {
    if (!this.shaCandidate || this.lookingUpSha) return;
    this.lookupSha.emit(this.shaCandidate);
  }

  onLoadMore(event: Event) {
    event.stopPropagation();
    if (!this.loadingMore) {
      this.loadMore.emit();
    }
  }

  onSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (this.filteredCommits.length > 0) {
        this.highlightedIndex = (this.highlightedIndex + 1) % this.filteredCommits.length;
        this.scrollHighlightedIntoView();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.filteredCommits.length > 0) {
        this.highlightedIndex =
          this.highlightedIndex <= 0 ? this.filteredCommits.length - 1 : this.highlightedIndex - 1;
        this.scrollHighlightedIntoView();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.highlightedIndex >= 0 && this.highlightedIndex < this.filteredCommits.length) {
        this.selectCommit(this.filteredCommits[this.highlightedIndex]);
      } else if (this.showShaLookupOption) {
        this.triggerShaLookup();
      } else if (this.showLatestOption && this.filteredCommits.length === 0) {
        this.selectLatest();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  getHighlightParts(text: string): HighlightParts | null {
    const q = this.trimmedQuery.toLowerCase();
    if (!q || !text) return null;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return null;
    return {
      before: text.slice(0, idx),
      match: text.slice(idx, idx + q.length),
      after: text.slice(idx + q.length)
    };
  }

  trackByCommit(_index: number, commit: CommitInfo): string {
    return commit.sha;
  }

  private extractShaCandidate(raw: string): string {
    const q = raw.trim();
    if (!q) return '';
    const urlMatch = q.match(/github\.com\/[^/\s]+\/[^/\s]+\/commit\/([0-9a-f]{4,40})/i);
    if (urlMatch) return urlMatch[1].toLowerCase();
    if (/^[0-9a-f]{4,40}$/i.test(q)) return q.toLowerCase();
    return '';
  }

  private updateFiltered() {
    const q = this.trimmedQuery.toLowerCase();
    if (!q) {
      this.filteredCommits = [...this.commits];
      return;
    }

    const shaFilter = this.shaCandidate || q;
    this.filteredCommits = this.commits.filter(
      c =>
        c.sha.toLowerCase().includes(shaFilter) ||
        c.message.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q)
    );
  }

  private scrollHighlightedIntoView() {
    if (this.highlightedIndex < 0) return;
    const container = this.listContainer?.nativeElement;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-commit-idx="${this.highlightedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }
}