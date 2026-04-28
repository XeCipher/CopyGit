import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RepoNode } from '../../services/api.service';

@Component({
  selector: 'app-tree-node',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="ml-4 border-l border-github-border/30">
      <div class="flex items-center gap-2 py-1 hover:bg-github-border/20 rounded px-2 cursor-pointer group">
        <input 
          type="checkbox" 
          [(ngModel)]="node.selected" 
          (change)="onToggle(node)"
          class="rounded border-github-border text-github-primary bg-github-bg focus:ring-0 w-3 h-3"
        />
        
        <span *ngIf="node.type === 'directory'" class="text-yellow-500/80">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
        </span>

        <span *ngIf="node.type === 'file'" class="text-github-hover">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </span>

        <span class="text-[13px] select-none text-github-text/90 group-hover:text-white" [class.font-medium]="node.type === 'directory'">
          {{ node.name }}
        </span>
      </div>

      <div *ngIf="node.children">
        <app-tree-node *ngFor="let child of node.children" [node]="child"></app-tree-node>
      </div>
    </div>
  `
})
export class TreeNodeComponent {
  @Input() node!: RepoNode;

  onToggle(node: RepoNode) {
    if (node.children) {
      node.children.forEach(child => {
        child.selected = node.selected;
        this.onToggle(child);
      });
    }
  }
}