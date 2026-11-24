import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  HostListener,
  ElementRef,
  ViewChild,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface HighlightParts {
  before: string;
  match: string;
  after: string;
}

const BRANCH_PAGE_BATCH = 60;

@Component({
  selector: 'app-branch-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative w-full">

      <!-- Trigger button -->
      <button
        type="button"
        (click)="toggle()"
        [disabled]="disabled"
        [attr.aria-expanded]="isOpen"
        aria-haspopup="listbox"
        [title]="selectedBranch || 'Select branch'"
        class="cg-selector-trigger"
        [class.is-open]="isOpen"
        [class.is-disabled]="disabled">

        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"
             class="flex-shrink-0"
             [style.color]="branches.length > 0 ? 'var(--accent)' : 'var(--muted)'">
          <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
        </svg>

        <span class="flex-1 text-left truncate"
              [style.font-family]="selectedBranch ? 'JetBrains Mono, monospace' : 'Sora, sans-serif'"
              [style.font-size]="selectedBranch ? '13px' : '0.875rem'"
              [style.color]="selectedBranch ? 'var(--text)' : 'var(--muted)'">
          {{ loading ? 'Loading…' : (selectedBranch || 'Branch') }}
        </span>

        <div *ngIf="loading" class="spinner flex-shrink-0" style="width: 14px; height: 14px;"></div>
        <svg *ngIf="!loading" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
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

      <!-- Dropdown panel: bottom sheet on mobile, anchored popover on sm+ -->
      <div *ngIf="isOpen"
           role="listbox"
           aria-label="Branches"
           class="cg-dropdown-panel fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl sm:absolute sm:bottom-auto sm:right-auto sm:left-0 sm:top-[calc(100%+6px)] sm:w-72 sm:rounded-xl flex flex-col max-h-[76dvh] sm:max-h-[min(340px,calc(100dvh_-_13rem))] overflow-hidden">

        <!-- Mobile sheet handle + title -->
        <div class="sm:hidden flex flex-col items-center pt-2 pb-1.5 px-4 flex-shrink-0"
             style="border-bottom: 1px solid var(--border-subtle);">
          <div class="w-9 h-1 rounded-full mb-2.5" style="background: var(--border);"></div>
          <div class="w-full flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold" style="color: var(--text)">Select Branch</span>
              <span class="badge">{{ branches.length }}{{ truncated ? '+' : '' }}</span>
            </div>
            <button type="button"
                    (click)="close()"
                    class="w-7 h-7 rounded-lg flex items-center justify-center cg-hover-card"
                    style="color: var(--muted);"
                    aria-label="Close branch selector">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Search bar -->
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
              placeholder="Search branches…"
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
              aria-label="Clear branch search">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Branch list -->
        <div #listContainer
             (scroll)="onListScroll($event)"
             class="cg-dropdown-list relative flex-1 overflow-y-auto p-1.5 space-y-0.5 min-h-0">
          <button
            *ngFor="let branch of visibleBranches; let i = index; trackBy: trackByBranch"
            type="button"
            role="option"
            [attr.data-branch-idx]="i"
            [attr.aria-selected]="branch === selectedBranch"
            (click)="selectBranch(branch)"
            (pointerenter)="onItemPointerEnter(i, $event)"
            class="cg-dropdown-item w-full text-left px-2.5 py-2.5 sm:py-2 rounded-lg flex items-center gap-2 min-w-0"
            [class.is-selected]="branch === selectedBranch"
            [class.is-highlighted]="i === highlightedIndex && branch !== selectedBranch">

            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
                 class="flex-shrink-0"
                 [style.color]="branch === selectedBranch ? 'var(--accent)' : 'var(--muted)'">
              <line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>

            <span class="text-xs truncate flex-1 min-w-0"
                  style="font-family: 'JetBrains Mono', monospace;"
                  [style.color]="branch === selectedBranch ? 'var(--accent)' : 'var(--text)'"
                  [style.font-weight]="branch === selectedBranch ? '600' : '400'">
              <ng-container *ngIf="hasSearchQuery && getHighlightParts(branch) as parts; else plainBranch">
                {{ parts.before }}<mark class="cg-mark">{{ parts.match }}</mark>{{ parts.after }}
              </ng-container>
              <ng-template #plainBranch>{{ branch }}</ng-template>
            </span>

            <span *ngIf="branch === defaultBranch"
                  class="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                  style="background: var(--card); border: 1px solid var(--border); color: var(--muted);">
              default
            </span>

            <svg *ngIf="branch === selectedBranch" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"
                 class="flex-shrink-0"
                 style="color: var(--accent)">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>

          <!-- Progressive reveal fallback -->
          <button
            *ngIf="visibleBranches.length < filteredBranches.length"
            type="button"
            (click)="showMoreBranches($event)"
            class="w-full py-2 px-3 rounded-lg text-xs font-medium text-center cg-hover-card"
            style="color: var(--accent);">
            Show more ({{ filteredBranches.length - visibleBranches.length }} remaining)
          </button>

          <!-- Custom branch fallback when repository has more than the loaded pages -->
          <button
            *ngIf="showCustomOption"
            type="button"
            role="option"
            [attr.data-branch-idx]="visibleBranches.length"
            (click)="selectBranch(trimmedQuery)"
            (pointerenter)="onItemPointerEnter(visibleBranches.length, $event)"
            class="cg-dropdown-item w-full text-left px-2.5 py-2.5 sm:py-2 rounded-lg flex items-center gap-2 min-w-0"
            [class.is-highlighted]="highlightedIndex === visibleBranches.length">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"
                 class="flex-shrink-0" style="color: var(--accent)">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <span class="text-xs truncate flex-1" style="color: var(--text-secondary)">
              Use branch <span class="font-mono font-semibold" style="color: var(--accent)">"{{ trimmedQuery }}"</span>
            </span>
          </button>

          <div *ngIf="filteredBranches.length === 0 && !showCustomOption"
               class="py-8 px-4 text-center text-xs"
               style="color: var(--muted)">
            No branches match "{{ searchQuery }}"
          </div>
        </div>

        <!-- Footer -->
        <div class="px-3 py-1.5 flex items-center justify-between text-[11px] flex-shrink-0"
             style="border-top: 1px solid var(--border-subtle); background: var(--card); color: var(--muted);">
          <span>
            {{ filteredBranches.length }} of {{ branches.length }}{{ truncated ? '+' : '' }}
            {{ branches.length === 1 ? 'branch' : 'branches' }}
          </span>
          <span class="hidden sm:inline">↑↓ · Enter</span>
        </div>
      </div>
    </div>
  `
})
export class BranchSelectorComponent implements OnChanges, OnDestroy {
  @Input() branches: string[] = [];
  @Input() selectedBranch = '';
  @Input() defaultBranch = '';
  @Input() loading = false;
  @Input() disabled = false;
  @Input() truncated = false;

  @Output() branchSelected = new EventEmitter<string>();
  @Output() openChange = new EventEmitter<boolean>();

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  @ViewChild('listContainer') listContainer?: ElementRef<HTMLDivElement>;

  isOpen = false;
  searchQuery = '';
  hasSearchQuery = false;
  filteredBranches: string[] = [];
  visibleBranches: string[] = [];
  highlightedIndex = 0;
  private displayLimit = BRANCH_PAGE_BATCH;
  private rafId: number | null = null;

  constructor(
    private elRef: ElementRef<HTMLElement>,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['branches']) {
      this.updateFiltered();
      this.cdr.markForCheck();
    }
    if (changes['disabled'] && this.disabled && this.isOpen) {
      this.close();
    }
  }

  ngOnDestroy() {
    this.cancelScheduledFocus();
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

  get trimmedQuery(): string {
    return this.searchQuery.trim();
  }

  get showCustomOption(): boolean {
    const q = this.trimmedQuery;
    if (!q) return false;
    if (!this.truncated && this.branches.length < 100) return false;
    return !this.branches.some(b => b.toLowerCase() === q.toLowerCase());
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

    const rawIdx = this.branches.indexOf(this.selectedBranch);
    this.displayLimit = rawIdx >= BRANCH_PAGE_BATCH
      ? Math.min(this.branches.length, rawIdx + 20)
      : BRANCH_PAGE_BATCH;

    this.updateFiltered();
    const currentIdx = this.filteredBranches.indexOf(this.selectedBranch);
    this.highlightedIndex = currentIdx >= 0 ? currentIdx : 0;
    this.openChange.emit(true);
    this.cdr.markForCheck();

    this.scheduleFocusAndScroll(true);
  }

  close() {
    if (!this.isOpen) return;
    this.cancelScheduledFocus();
    this.isOpen = false;
    this.searchQuery = '';
    this.hasSearchQuery = false;
    this.openChange.emit(false);
    this.cdr.markForCheck();
  }

  onSearchChange() {
    this.displayLimit = BRANCH_PAGE_BATCH;
    this.updateFiltered();
    this.highlightedIndex = 0;
  }

  clearSearch() {
    this.searchQuery = '';
    this.onSearchChange();
    this.searchInput?.nativeElement?.focus();
  }

  selectBranch(branch: string) {
    const changed = branch !== this.selectedBranch;
    this.close();
    if (changed) {
      this.branchSelected.emit(branch);
    }
  }

  onItemPointerEnter(index: number, event: PointerEvent) {
    if (event.pointerType === 'mouse' && this.highlightedIndex !== index) {
      this.highlightedIndex = index;
    }
  }

  onListScroll(event: Event) {
    if (this.visibleBranches.length >= this.filteredBranches.length) return;
    const container = event.target as HTMLElement | null;
    if (!container) return;

    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 120) {
      this.displayLimit += BRANCH_PAGE_BATCH;
      this.updateVisibleBranches();
      this.cdr.markForCheck();
    }
  }

  showMoreBranches(event: Event) {
    event.stopPropagation();
    this.displayLimit += BRANCH_PAGE_BATCH;
    this.updateVisibleBranches();
    this.cdr.markForCheck();
  }

  onSearchKeydown(event: KeyboardEvent) {
    const totalOptions = this.filteredBranches.length + (this.showCustomOption ? 1 : 0);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (totalOptions > 0) {
        this.highlightedIndex = (this.highlightedIndex + 1) % totalOptions;
        this.ensureHighlightedVisible();
        this.scheduleFocusAndScroll(false);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (totalOptions > 0) {
        this.highlightedIndex = (this.highlightedIndex - 1 + totalOptions) % totalOptions;
        this.ensureHighlightedVisible();
        this.scheduleFocusAndScroll(false);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.highlightedIndex < this.filteredBranches.length) {
        const chosen = this.filteredBranches[this.highlightedIndex];
        if (chosen) this.selectBranch(chosen);
      } else if (this.showCustomOption) {
        this.selectBranch(this.trimmedQuery);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    }
  }

  getHighlightParts(branchName: string): HighlightParts | null {
    const q = this.trimmedQuery.toLowerCase();
    if (!q) return null;
    const idx = branchName.toLowerCase().indexOf(q);
    if (idx === -1) return null;
    return {
      before: branchName.slice(0, idx),
      match: branchName.slice(idx, idx + q.length),
      after: branchName.slice(idx + q.length)
    };
  }

  trackByBranch(_index: number, branch: string): string {
    return branch;
  }

  private ensureHighlightedVisible() {
    if (
      this.highlightedIndex < this.filteredBranches.length &&
      this.highlightedIndex >= this.visibleBranches.length
    ) {
      this.displayLimit = Math.max(this.displayLimit, this.highlightedIndex + 20);
      this.updateVisibleBranches();
    }
  }

  private updateFiltered() {
    const q = this.trimmedQuery.toLowerCase();
    this.hasSearchQuery = q.length > 0;
    this.filteredBranches = q
      ? this.branches.filter(b => b.toLowerCase().includes(q))
      : [...this.branches];
    this.updateVisibleBranches();
  }

  private updateVisibleBranches() {
    this.visibleBranches =
      this.filteredBranches.length <= this.displayLimit
        ? this.filteredBranches
        : this.filteredBranches.slice(0, this.displayLimit);
  }

  private scheduleFocusAndScroll(shouldFocusInput: boolean) {
    this.cancelScheduledFocus();
    this.ngZone.runOutsideAngular(() => {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        if (!this.isOpen) return;
        // Avoid popping up the soft keyboard automatically on small touch screens
        if (shouldFocusInput && window.innerWidth >= 640) {
          this.searchInput?.nativeElement?.focus({ preventScroll: true });
        }
        this.scrollHighlightedIntoView();
      });
    });
  }

  private cancelScheduledFocus() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private scrollHighlightedIntoView() {
    const container = this.listContainer?.nativeElement;
    if (!container || this.highlightedIndex < 0) return;
    const el = container.querySelector<HTMLElement>(`[data-branch-idx="${this.highlightedIndex}"]`);
    if (!el) return;

    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (elTop < viewTop) {
      container.scrollTop = Math.max(0, elTop - 4);
    } else if (elBottom > viewBottom) {
      container.scrollTop = elBottom - container.clientHeight + 4;
    }
  }
}