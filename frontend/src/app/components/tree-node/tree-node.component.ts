import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RepoNode } from '../../services/api.service';

@Component({
  selector: 'app-tree-node',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="select-none">

      <!-- Row -->
      <div
        class="tree-row flex items-center gap-1.5 px-2 py-[3px] cursor-pointer group"
        [style.padding-left.px]="(depth * 16) + 8"
        (click)="onRowClick($event)">

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
          [checked]="node.selected"
          [indeterminate]="isIndeterminate"
          (change)="onCheckChange($event)"
          (click)="$event.stopPropagation()"
        />

        <!-- Icon -->
        <span class="w-4 h-4 flex items-center justify-center flex-shrink-0">
          <!-- Directory icon -->
          <svg *ngIf="node.type === 'directory'" width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1.5 3.5C1.5 2.94772 1.94772 2.5 2.5 2.5H5.79289L7.29289 4H12.5C13.0523 4 13.5 4.44772 13.5 5V11.5C13.5 12.0523 13.0523 12.5 12.5 12.5H2.5C1.94772 12.5 1.5 12.0523 1.5 11.5V3.5Z"
              [attr.fill]="expanded ? 'var(--accent)' : 'none'"
              [attr.stroke]="expanded ? 'var(--accent)' : 'var(--muted)'"
              stroke-width="1.1"/>
          </svg>

          <!-- File icon (colored dot by extension) -->
          <span *ngIf="node.type === 'file'" class="w-2 h-2 rounded-full flex-shrink-0" [style.background-color]="extColor"></span>
        </span>

        <!-- Name (Safely binding highlighted HTML) -->
        <span
          class="text-[12.5px] leading-none truncate flex-1"
          [style.font-family]="'JetBrains Mono, monospace'"
          [style.font-weight]="node.type === 'directory' ? '500' : '400'"
          [style.color]="node.type === 'directory' ? 'var(--text)' : 'var(--text-secondary)'"
          [innerHTML]="getHighlightedName()">
        </span>

        <!-- File/Folder size badge (Always visible) -->
        <span
          *ngIf="node.size !== undefined"
          class="text-[10px] flex-shrink-0 opacity-70"
          [style.color]="'var(--muted)'"
          [style.font-family]="'JetBrains Mono, monospace'">
          {{ formatSize(node.size) }}
        </span>
      </div>

      <!-- Children -->
      <div *ngIf="node.type === 'directory' && node.children && expanded">
        <app-tree-node
          *ngFor="let child of node.children"
          [node]="child"
          [depth]="depth + 1"
          [searchQuery]="searchQuery"
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
  @Output() selectionChange = new EventEmitter<void>();

  expanded: boolean = true;

  ngOnInit() {
    if (this.node.expanded !== undefined) {
      this.expanded = this.node.expanded;
    } else if (this.depth > 1) {
      this.expanded = false;
    }
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['node'] && this.node.expanded !== undefined) {
      this.expanded = this.node.expanded;
    }
  }

  get isIndeterminate(): boolean {
    if (this.node.type !== 'directory' || !this.node.children?.length) return false;
    const files = this.collectFiles(this.node);
    const selected = files.filter(f => f.selected).length;
    return selected > 0 && selected < files.length;
  }

  get extColor(): string {
    const ext = this.node.name.split('.').pop()?.toLowerCase() || '';
    const colors: Record<string, string> = {
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
    };
    return colors[ext] || '#6b7280';
  }

  onRowClick(e: MouseEvent) {
    if (this.node.type === 'directory') {
      this.expanded = !this.expanded;
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
      node.children.forEach(c => this.setSelected(c, val));
    }
  }

  onChildSelectionChange() {
    // Sync directory checkbox state based on children
    if (this.node.type === 'directory' && this.node.children?.length) {
      const files = this.collectFiles(this.node);
      const allSelected = files.every(f => f.selected);
      const noneSelected = files.every(f => !f.selected);
      this.node.selected = allSelected ? true : noneSelected ? false : undefined as any;
    }
    this.selectionChange.emit();
  }

  private collectFiles(node: RepoNode): RepoNode[] {
    const result: RepoNode[] = [];
    if (node.type === 'file') {
      result.push(node);
    } else if (node.children) {
      node.children.forEach(c => result.push(...this.collectFiles(c)));
    }
    return result;
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Employs query searching matching the last provided name and injects <mark> styled via the global stylesheet
  getHighlightedName(): string {
    if (!this.searchQuery || !this.searchQuery.trim()) {
      return this.escapeHtml(this.node.name);
    }
    
    const name = this.node.name;
    const q = this.searchQuery.toLowerCase().trim();
    
    // Evaluate if user is trying to find a sub-file with a path separator (e.g., 'src/app')
    let queryToHighlight = q;
    if (q.includes('/')) {
      const parts = q.split('/');
      const lastPart = parts[parts.length - 1];
      if (lastPart && name.toLowerCase().includes(lastPart)) {
        queryToHighlight = lastPart;
      } else {
        return this.escapeHtml(name);
      }
    }

    const index = name.toLowerCase().indexOf(queryToHighlight);
    if (index === -1) return this.escapeHtml(name);

    const before = this.escapeHtml(name.substring(0, index));
    const match = this.escapeHtml(name.substring(index, index + queryToHighlight.length));
    const after = this.escapeHtml(name.substring(index + queryToHighlight.length));

    // Dynamic style implementation to match both modes flawlessly
    return `${before}<mark style="background: var(--accent-dim); color: var(--accent); border-radius: 3px; padding: 0 2px;">${match}</mark>${after}`;
  }

  private escapeHtml(str: string): string {
    return str.replace(/[&<>'"]/g, 
      tag => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;'
        }[tag as string] || tag)
    );
  }
}