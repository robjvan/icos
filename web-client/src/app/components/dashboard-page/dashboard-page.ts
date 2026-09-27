import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavTabsComponent } from '../nav-tabs-component/nav-tabs-component';
import { FooterComponent } from '../footer-component/footer-component';
import { RealtimeService } from '../../services/realtime.service';

@Component({
  selector: 'app-dashboard-page',
  imports: [NavTabsComponent, RouterOutlet, FooterComponent],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage implements OnInit {
  private readonly realtime = inject(RealtimeService);

  ngOnInit(): void {
    // Single socket for the shell; all tabs share it. Failure never
    // breaks chat — the footer falls back to polling.
    this.realtime.start();
  }
}
