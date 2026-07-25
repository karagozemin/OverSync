import { render, screen } from "@testing-library/react";
import { describe, test, expect } from "vitest";
import { RefundTimelineSimulator } from "./RefundTimelineSimulator";

describe("RefundTimelineSimulator", () => {
  test("renders the simulator header", () => {
    render(<RefundTimelineSimulator />);
    expect(screen.getByText("Refund Timeline Simulator")).toBeInTheDocument();
  });

  test("shows read-only simulation badge", () => {
    render(<RefundTimelineSimulator />);
    expect(screen.getByText("Read-only simulation")).toBeInTheDocument();
  });

  test("shows read-only disclaimer", () => {
    render(<RefundTimelineSimulator />);
    expect(screen.getByText(/read-only simulator/i)).toBeInTheDocument();
    expect(screen.getByText(/does not submit any transactions/i)).toBeInTheDocument();
  });

  test("renders example scenario buttons", () => {
    render(<RefundTimelineSimulator />);
    expect(screen.getByText("ETH → XLM — Waiting")).toBeInTheDocument();
    expect(screen.getByText("ETH → XLM — Claimable")).toBeInTheDocument();
    expect(screen.getByText("ETH → XLM — Refundable")).toBeInTheDocument();
    expect(screen.getByText("XLM → ETH — Waiting")).toBeInTheDocument();
    expect(screen.getByText("XLM → ETH — Claimable")).toBeInTheDocument();
    expect(screen.getByText("XLM → ETH — Refundable")).toBeInTheDocument();
  });

  test("defaults to the claimable example", () => {
    render(<RefundTimelineSimulator />);
    expect(screen.getByText("Claimable")).toBeInTheDocument();
  });

  test("displays timelock expiry sections", () => {
    render(<RefundTimelineSimulator />);
    const sections = screen.getAllByText(/timelock expiry/i);
    expect(sections).toHaveLength(2);
  });

  test("shows claimable by section", () => {
    render(<RefundTimelineSimulator />);
    expect(screen.getByText("Claimable by")).toBeInTheDocument();
  });

  test("shows refundable by section", () => {
    render(<RefundTimelineSimulator />);
    expect(screen.getByText("Refundable by")).toBeInTheDocument();
  });

  test("renders example selector prompt", () => {
    render(<RefundTimelineSimulator />);
    expect(screen.getByText("Select an example scenario:")).toBeInTheDocument();
  });

  test("displays direction labels for default ETH → XLM", () => {
    render(<RefundTimelineSimulator />);
    expect(screen.getByText("Ethereum")).toBeInTheDocument();
    expect(screen.getByText("Stellar")).toBeInTheDocument();
  });

  test("shows state description for claimable", () => {
    render(<RefundTimelineSimulator />);
    expect(screen.getByText(/Funds are locked/i)).toBeInTheDocument();
  });
});
