package com.snoworca.TTTGate;

public interface OnTransferListener {
    void onEvent(int id, TransferState state, byte[] data);
}
