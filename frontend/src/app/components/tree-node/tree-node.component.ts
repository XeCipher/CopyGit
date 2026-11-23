import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RepoNode } from '../../services/api.service';

interface HighlightParts {
  before: string;
  match: string;
  after: string;
}

const EXT_COLORS: Record<string, string> = {
  ts: '#3b82f6', tsx: '#06b6d4', js: '#eab308', jsx: '#f97316',
  py: '#22c55e', rb: '#ef4444', go: '#06b6d4', rs: '#f97316',
  html: '#f97316', htm: '#f97316', css: '#ec4899', scss: '#ec4899',
  sass: '#ec4899', less: '#3b82f6',
  json: '#a78bfa', yaml: '#a78bfa', yml: '#a78bfa', toml: '#a78bfa',
  md: '#94a3b8', mdx: '#94a3b8', txt: '#94a3b8',
  java: '#ef4444', kt: '#a78bfa', swift: '#f97316', dart: '#06b6d4',
  c: '#3b82f6', cpp: '#3b82f6', cs: '#a78bfa', php: '#a78bfa',
  sh: '#22c55e', bash: '#22c55e', zsh: '#22c55e',
  sql: '#3b82f6', graphql: '#ec4899',
  vue: '#22c55e', svelte: '#f97316',
  xml: '#f97316', env: '#eab308',
  lock: '#94a3b8', gitignore: '#94a3b8',
  png: '#10b981', jpg: '#10b981', jpeg: '#10b981', gif: '#10b981', svg: '#10b981', ico: '#10b981',
  pdf: '#ef4444', zip: '#f59e0b', tar: '#f59e0b', gz: '#f59e0b',
  mp4: '#8b5cf6', mp3: '#8b5cf6',
  exe: '#ef4444', dll: '#ef4444', so: '#ef4444',
  rvt: '#3b82f6'
};

@Component({
  selector: 'app-tree-node',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="select-none">

      <!-- Row -->
      <div
        class="tree-row flex items-center gap-1.5 px-2 py-1.5 sm:py-[3px] cursor-pointer group"
        [style.padding-left.px]="(depth * 16) + 8"
        (click)="onRowClick()">

        <!-- Expand arrow (directories only) -->
        <span
          *ngIf="node.type === 'directory'"
          class="w-4 h-4 flex items-center justify-center flex-shrink-0 transition-transform duration-150"
          [style.transform]="expanded ? 'rotate(90deg)' : 'rotate(0deg)'"
          style="color: var(--muted)">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M3 2L7 5L3 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </span>

        <!-- Spacer for files (align with directories) -->
        <span *ngIf="node.type === 'file'" class="w-4 flex-shrink-0"></span>

        <!-- Checkbox -->
        <input
          type="checkbox"
          class="cg-check"
          [checked]="isChecked"
          [indeterminate]="isIndeterminate"
          [attr.aria-label]="'Select ' + node.name"
          (change)="onCheckChange($event)"
          (click)="$event.stopPropagation()"
        />

        <!-- Icon -->
        <span class="w-4 h-4 flex items-center justify-center flex-shrink-0">
          <svg *ngIf="node.type === 'directory'" width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1.5 3.5C1.5 2.94772 1.94772 2.5 2.5 2.5H5.79289L7.29289 4H12.5C13.0523 4 13.5 4.44772 13.5 5V11.5C13.5 12.0523 13.0523 12.5 12.5 12.5H2.5C1.94772 12.5 1.5 12.0523 1.5 11.5V3.5Z"
              [attr.fill]="expanded ? 'var(--accent)' : 'none'"
              [attr.stroke]="expanded ? 'var(--accent)' : 'var(--muted)'"
              stroke-width="1.1"/>
          </svg>

          <span *ngIf="node.type === 'file'" class="w-2 h-2 rounded-full flex-shrink-0" [style.background-color]="extColor"></span>
        </span>

        <!-- Name -->
        <span
          class="text-[12.5px] leading-none truncate flex-1"
          [style.font-family]="'JetBrains Mono, monospace'"
          [style.font-weight]="node.type === 'directory' ? '500' : '400'"
          [style.color]="node.type === 'directory' ? 'var(--text)' : 'var(--text-secondary)'"
          [title]="node.path">
          <ng-container *ngIf="highlightParts; else plainName">
            {{ highlightParts.before }}<mark class="cg-mark">{{ highlightParts.match }}</mark>{{ highlightParts.after }}
          </ng-container>
          <ng-template #plainName>{{ node.name }}</ng-template>
        </span>

        <!-- File/Folder size badge -->
        <span
          *ngIf="node.size !== undefined"
          class="text-[10px] flex-shrink-0"
          [style.color]="'var(--muted)'"
          [style.font-family]="'JetBrains Mono, monospace'">
          {{ formattedSize }}
        </span>
      </div>

      <!-- Children -->
      <div *ngIf="node.type === 'directory' && node.children && expanded">
        <app-tree-node
          *ngFor="let child of node.children; trackBy: trackByNode"
          [node]="child"
          [depth]="depth + 1"
          [searchQuery]="searchQuery"
          [expandRevision]="expandRevision"
          (selectionChange)="onChildSelectionChange()">
        </app-tree-node>
      </div>
    </div>
  `
})
export class TreeNodeComponent implements OnInit, OnChanges {
  @Input() node!: RepoNode;
  @Input() depth: number = 0;
  @Input() searchQuery: string = '';
  @Input() expandRevision: number = 0;
  @Output() selectionChange = new EventEmitter<void>();

  expanded: boolean = true;
  extColor: string = '#7c8494';
  formattedSize: string = '';
  highlightParts: HighlightParts | null = null;

  ngOnInit() {
    this.syncVisualProps();
    this.syncExpandedState();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['node']) {
      this.syncVisualProps();
      this.syncExpandedState();
    } else {
      if (changes['expandRevision']) {
        this.syncExpandedState();
      }
      if (changes['searchQuery']) {
        this.updateHighlight();
      }
    }
  }

  private syncExpandedState() {
    if (this.node.expanded !== undefined) {
      this.expanded = this.node.expanded;
    } else {
      this.expanded = this.depth <= 1;
    }
  }

  private syncVisualProps() {
    const ext = this.node.name.split('.').pop()?.toLowerCase() || '';
    this.extColor = EXT_COLORS[ext] || '#7c8494';
    this.formattedSize = this.node.size !== undefined ? this.formatSize(this.node.size) : '';
    this.updateHighlight();
  }

  private updateHighlight() {
    const rawQuery = this.searchQuery?.trim();
    if (!rawQuery) {
      this.highlightParts = null;
      return;
    }

    const name = this.node.name;
    let queryToHighlight = rawQuery.toLowerCase();

    if (queryToHighlight.includes('/')) {
      const parts = queryToHighlight.split('/').filter(Boolean);
      const lastPart = parts[parts.length - 1];
      if (!lastPart || !name.toLowerCase().includes(lastPart)) {
        this.highlightParts = null;
        return;
      }
      queryToHighlight = lastPart;
    }

    const index = name.toLowerCase().indexOf(queryToHighlight);
    if (index === -1) {
      this.highlightParts = null;
      return;
    }

    this.highlightParts = {
      before: name.slice(0, index),
      match: name.slice(index, index + queryToHighlight.length),
      after: name.slice(index + queryToHighlight.length)
    };
  }

  get isIndeterminate(): boolean {
    if (this.node.type !== 'directory') return false;
    const total = this.node.fileCount ?? 0;
    const selected = this.node.selectedCount ?? 0;
    return selected > 0 && selected < total;
  }

  get isChecked(): boolean {
    if (this.node.type === 'file') return !!this.node.selected;
    const total = this.node.fileCount ?? 0;
    if (total === 0) return false;
    return (this.node.selectedCount ?? 0) === total;
  }

  onRowClick() {
    if (this.node.type === 'directory') {
      this.expanded = !this.expanded;
      // Persist user expand preference only when viewing the unfiltered tree
      if (!this.searchQuery.trim()) {
        this.node.expanded = this.expanded;
      }
    } else {
      this.node.selected = !this.node.selected;
      this.selectionChange.emit();
    }
  }

  onCheckChange(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.setSelected(this.node, checked);
    this.selectionChange.emit();
  }

  private setSelected(node: RepoNode, val: boolean) {
    node.selected = val;
    if (node.children) {
      for (const child of node.children) {
        this.setSelected(child, val);
      }
    }
  }

  onChildSelectionChange() {
    this.selectionChange.emit();
  }

  trackByNode(_index: number, node: RepoNode): string {
    return node.path;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}